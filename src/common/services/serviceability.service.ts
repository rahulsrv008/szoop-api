import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CityWaitlist, UpcomingCity } from 'src/database/entities';
import { haversineKm } from 'src/common/geo/geo.util';
import { UPCOMING_CITIES } from 'src/database/seeds/upcoming-cities.data';
import { CITY_WAITLIST_MAX_CITIES } from 'src/common/rate-limit/rate-limit.rules';
import {
  ZoneLookup,
  ZoneResolverService,
  ZoneSummary,
} from './zone-resolver.service';

/** Mirrors sql/upcoming_cities.sql. */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS upcoming_cities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  city VARCHAR(100) NOT NULL UNIQUE,
  nickname VARCHAR(100),
  state VARCHAR(100),
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  radius_km INT NOT NULL DEFAULT 25,
  message TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS city_waitlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  city_key VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  upcoming_city_id UUID REFERENCES upcoming_cities(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_city_waitlist_customer_city UNIQUE (customer_id, city_key)
);

CREATE INDEX IF NOT EXISTS idx_city_waitlist_city_key ON city_waitlist (city_key);
`;

export interface ComingSoon {
  serviceable: false;
  city: string | null;
  nickname: string | null;
  state: string | null;
  title: string;
  message: string;
  canNotify: boolean;
}

export type Serviceability = { serviceable: true; zone: ZoneSummary } | ComingSoon;

const CITY_CACHE_MS = 60_000;

const normalize = (value: string | null | undefined) =>
  (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Answers "do we serve this location?" and, when we don't, greets the city by
 * name — "We'll be available soon in Taj City!" for Agra.
 */
@Injectable()
export class ServiceabilityService implements OnModuleInit {
  private readonly logger = new Logger(ServiceabilityService.name);
  private citiesCache: { at: number; rows: Promise<UpcomingCity[]> } | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly zones: ZoneResolverService,
    @InjectRepository(UpcomingCity)
    private readonly cityRepo: Repository<UpcomingCity>,
    @InjectRepository(CityWaitlist)
    private readonly waitlistRepo: Repository<CityWaitlist>,
  ) {}

  async onModuleInit() {
    try {
      await this.dataSource.query(SCHEMA_SQL);
      await this.seed();
    } catch (err) {
      this.logger.error('Failed to ensure upcoming cities schema/seed', err as Error);
    }
  }

  async check(input: ZoneLookup): Promise<Serviceability> {
    const zone = await this.zones.resolve(input);
    if (zone) return { serviceable: true, zone: this.zones.summary(zone)! };
    return this.comingSoon(input);
  }

  /** The "not here yet" payload for a location already known to be outside every zone. */
  async comingSoon(input: ZoneLookup): Promise<ComingSoon> {
    return this.describe(input, await this.findUpcomingCity(input));
  }

  /** "Notify me" — idempotent per customer and city. */
  async joinWaitlist(customerId: string, input: ZoneLookup) {
    const zone = await this.zones.resolve(input);
    if (zone) {
      return { joined: false, status: { serviceable: true, zone: this.zones.summary(zone)! } };
    }
    const upcoming = await this.findUpcomingCity(input);
    const status = this.describe(input, upcoming);
    if (!status.city) return { joined: false, status };

    const cityKey = normalize(status.city);
    const already = await this.waitlistRepo.exists({ where: { customerId, cityKey } });
    if (already) return { joined: true, status };
    if ((await this.waitlistRepo.count({ where: { customerId } })) >= CITY_WAITLIST_MAX_CITIES) {
      throw new BadRequestException(
        `You can follow up to ${CITY_WAITLIST_MAX_CITIES} cities. We'll let you know as we launch in them.`,
      );
    }

    await this.waitlistRepo
      .createQueryBuilder()
      .insert()
      .values({
        customerId,
        cityKey,
        city: status.city,
        upcomingCityId: upcoming?.id ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      })
      .orIgnore()
      .execute();
    return { joined: true, status };
  }

  private describe(input: ZoneLookup, upcoming: UpcomingCity | null): ComingSoon {
    const city = upcoming?.city ?? (input.city?.trim() || null);
    const nickname = upcoming?.nickname ?? null;
    const place = nickname || city;

    return {
      serviceable: false,
      city,
      nickname,
      state: upcoming?.state ?? null,
      title: place ? `Coming soon to ${place}` : 'Coming soon to your area',
      message:
        upcoming?.message ||
        (place
          ? `We'll be available soon in ${place}!`
          : "We're not in your area yet, but we're expanding fast!"),
      canNotify: !!city,
    };
  }

  /** Upcoming cities change rarely (edited in the database), so a short cache keeps checks off Postgres. */
  private activeCities() {
    const now = Date.now();
    if (!this.citiesCache || now - this.citiesCache.at > CITY_CACHE_MS) {
      const rows = this.cityRepo.find({ where: { isActive: true } });
      this.citiesCache = { at: now, rows };
      rows.catch(() => {
        if (this.citiesCache?.rows === rows) this.citiesCache = null;
      });
    }
    return this.citiesCache.rows;
  }

  invalidateCache() {
    this.citiesCache = null;
  }

  private async findUpcomingCity(input: ZoneLookup) {
    const cities = await this.activeCities();
    const latitude = input.latitude == null ? null : Number(input.latitude);
    const longitude = input.longitude == null ? null : Number(input.longitude);

    // The map pin wins over the typed/geocoded city name, which varies wildly.
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      const nearest = cities
        .filter((c) => c.latitude != null && c.longitude != null)
        .map((c) => ({
          city: c,
          km: haversineKm(latitude!, longitude!, c.latitude!, c.longitude!),
        }))
        .filter((entry) => entry.km <= entry.city.radiusKm)
        .sort((a, b) => a.km - b.km)[0];
      if (nearest) return nearest.city;
    }

    const name = normalize(input.city);
    if (!name) return null;
    return (
      cities.find(
        (c) =>
          normalize(c.city) === name ||
          (c.aliases ?? []).some((alias) => normalize(alias) === name),
      ) ?? null
    );
  }

  private async seed() {
    await this.cityRepo
      .createQueryBuilder()
      .insert()
      .values(
        UPCOMING_CITIES.map((c) => ({
          city: c.city,
          nickname: c.nickname,
          state: c.state,
          aliases: c.aliases,
          latitude: c.latitude,
          longitude: c.longitude,
          radiusKm: c.radiusKm,
        })),
      )
      .orIgnore()
      .execute();
  }
}
