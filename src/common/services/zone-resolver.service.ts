import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { backfillH3Cells } from 'src/common/geo/h3-backfill';
import {
  Agent,
  Customer,
  CustomerAddress,
  ServiceArea,
  ServiceZoneArea,
} from 'src/database/entities';

const SCHEMA_SQL = `
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS home_zone UUID REFERENCES service_areas(id) ON DELETE SET NULL;
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS service_areas UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS current_location JSONB;
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS home_zone UUID REFERENCES service_areas(id) ON DELETE SET NULL;
ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS service_area_id UUID REFERENCES service_areas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_home_zone ON agents (home_zone);
CREATE INDEX IF NOT EXISTS idx_customers_home_zone ON customers (home_zone);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_service_area
  ON customer_addresses (service_area_id);

-- H3 geo index for agent <-> job matching (mirrors sql/dispatch_geo.sql).
ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS h3_cell VARCHAR(16);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS current_h3_cell VARCHAR(16);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS home_h3_cell VARCHAR(16);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_h3_cell ON customer_addresses (h3_cell);
CREATE INDEX IF NOT EXISTS idx_agents_current_h3_cell ON agents (current_h3_cell);
CREATE INDEX IF NOT EXISTS idx_agents_home_h3_cell ON agents (home_h3_cell);
CREATE INDEX IF NOT EXISTS idx_agent_locations_agent_recorded
  ON agent_locations (agent_id, recorded_at DESC);
`;

export interface ZoneLookup {
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
}

export interface ZoneSummary {
  id: string;
  code: string | null;
  name: string;
  city: string | null;
  region: string | null;
}

/** How stale a zone change may be on other servers before they see it. */
const ZONE_CACHE_MS = 60_000;

@Injectable()
export class ZoneResolverService implements OnModuleInit {
  private readonly logger = new Logger(ZoneResolverService.name);
  private zonesCache: { at: number; rows: Promise<ServiceArea[]> } | null = null;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ServiceArea)
    private readonly areaRepo: Repository<ServiceArea>,
    @InjectRepository(ServiceZoneArea)
    private readonly zoneAreaRepo: Repository<ServiceZoneArea>,
    @InjectRepository(CustomerAddress)
    private readonly addressRepo: Repository<CustomerAddress>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
  ) {}

  async onModuleInit() {
    try {
      await this.dataSource.query(SCHEMA_SQL);
      await this.backfill();
    } catch (err) {
      this.logger.error('Failed to ensure agent/customer zone columns', err as Error);
    }
    try {
      const filled = await backfillH3Cells(this.dataSource);
      const total = filled.addresses + filled.agentLocations + filled.agentHomes;
      if (total) this.logger.log(`Backfilled H3 cells: ${JSON.stringify(filled)}`);
    } catch (err) {
      this.logger.error('Failed to backfill H3 cells', err as Error);
    }
  }

  summary(area: ServiceArea | null | undefined): ZoneSummary | null {
    if (!area) return null;
    return {
      id: area.id,
      code: area.code ?? null,
      name: area.name,
      city: area.city ?? null,
      region: area.region ?? null,
    };
  }

  async summariesById(ids: Array<string | null | undefined>): Promise<Map<string, ZoneSummary>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map();
    const rows = await this.areaRepo.find({ where: { id: In(unique) } });
    return new Map(rows.map((row) => [row.id, this.summary(row)!]));
  }

  async listSummaries(ids: Array<string | null | undefined>): Promise<ZoneSummary[]> {
    const map = await this.summariesById(ids);
    return [...new Set(ids.filter((id): id is string => !!id))]
      .map((id) => map.get(id))
      .filter((row): row is ZoneSummary => !!row);
  }

  async summaryById(id: string | null | undefined): Promise<ZoneSummary | null> {
    if (!id) return null;
    const map = await this.summariesById([id]);
    return map.get(id) ?? null;
  }

  async requireAreas(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return [];
    const rows = await this.areaRepo.find({
      where: { id: In(unique), isActive: true },
    });
    if (rows.length !== unique.length) {
      const found = new Set(rows.map((row) => row.id));
      const missing = unique.filter((id) => !found.has(id));
      throw new BadRequestException(
        `Unknown or inactive service zone(s): ${missing.join(', ')}`,
      );
    }
    return rows;
  }

  async resolve(input: ZoneLookup): Promise<ServiceArea | null> {
    const pincode = input.pincode?.trim() || null;
    const city = input.city?.trim() || null;
    const latitude = this.toCoord(input.latitude);
    const longitude = this.toCoord(input.longitude);

    if (pincode) {
      const matches = await this.zoneAreaRepo.find({
        where: { pincode },
        relations: ['serviceArea'],
      });
      const active = matches
        .map((row) => row.serviceArea)
        .filter((area): area is ServiceArea => !!area?.isActive);
      const unique = this.uniqueAreas(active);
      if (unique.length === 1) return unique[0];
      if (unique.length > 1) {
        return this.pickClosest(unique, latitude, longitude) ?? unique[0];
      }
    }

    if (latitude != null && longitude != null) {
      const zones = await this.activeZones();
      const within = zones
        .map((zone) => ({
          zone,
          distance: this.distanceKm(
            latitude,
            longitude,
            zone.latitude,
            zone.longitude,
          ),
        }))
        .filter(
          (entry) =>
            entry.distance != null &&
            entry.distance <= (entry.zone.serviceRadiusKm || 3),
        )
        .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
      if (within[0]) return within[0].zone;
    }

    if (city) {
      const byCity = await this.areaRepo.find({
        where: { city, isActive: true },
        take: 20,
      });
      if (byCity.length === 1) return byCity[0];
      if (byCity.length > 1) {
        return this.pickClosest(byCity, latitude, longitude) ?? byCity[0];
      }
    }

    return null;
  }

  /**
   * Active zones, cached briefly: every location check needs all of them and
   * they only change through the admin panel. Treat the rows as read-only.
   */
  private activeZones() {
    const now = Date.now();
    if (!this.zonesCache || now - this.zonesCache.at > ZONE_CACHE_MS) {
      const rows = this.areaRepo.find({ where: { isActive: true } });
      // One query even when many requests miss at once; a failed load isn't cached.
      this.zonesCache = { at: now, rows };
      rows.catch(() => {
        if (this.zonesCache?.rows === rows) this.zonesCache = null;
      });
    }
    return this.zonesCache.rows;
  }

  /** Call after zones change. Other servers pick the change up within ZONE_CACHE_MS. */
  invalidateCache() {
    this.zonesCache = null;
  }

  private async backfill() {
    const addresses = await this.addressRepo.find({
      where: { serviceAreaId: IsNull() },
    });
    let addressCount = 0;
    for (const address of addresses) {
      const zone = await this.resolve({
        pincode: address.pincode,
        latitude: address.latitude == null ? null : Number(address.latitude),
        longitude: address.longitude == null ? null : Number(address.longitude),
        city: address.city,
      });
      if (!zone) continue;
      address.serviceAreaId = zone.id;
      await this.addressRepo.save(address);
      if (address.isDefault) {
        await this.customerRepo.update(
          { id: address.customerId },
          { homeZoneId: zone.id },
        );
      }
      addressCount += 1;
    }

    const agents = await this.agentRepo.find({ where: { homeZoneId: IsNull() } });
    let agentCount = 0;
    for (const agent of agents) {
      const zone = await this.resolve({
        pincode: agent.pincode,
        latitude: agent.latitude == null ? null : Number(agent.latitude),
        longitude: agent.longitude == null ? null : Number(agent.longitude),
        city: agent.city,
      });
      if (!zone) continue;
      agent.homeZoneId = zone.id;
      await this.agentRepo.save(agent);
      agentCount += 1;
    }

    if (addressCount || agentCount) {
      this.logger.log(
        `Backfilled zones for ${addressCount} customer address(es) and ${agentCount} agent home zone(s)`,
      );
    }
  }

  private uniqueAreas(areas: ServiceArea[]) {
    const map = new Map<string, ServiceArea>();
    for (const area of areas) map.set(area.id, area);
    return [...map.values()];
  }

  private pickClosest(
    areas: ServiceArea[],
    latitude: number | null,
    longitude: number | null,
  ) {
    if (latitude == null || longitude == null) return null;
    const ranked = areas
      .map((area) => ({
        area,
        distance: this.distanceKm(latitude, longitude, area.latitude, area.longitude),
      }))
      .filter((entry) => entry.distance != null)
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return ranked[0]?.area ?? null;
  }

  private distanceKm(
    lat1: number,
    lng1: number,
    lat2: number | null,
    lng2: number | null,
  ) {
    if (lat2 == null || lng2 == null) return null;
    const toRad = (value: number) => (value * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(a));
  }

  private toCoord(value: number | string | null | undefined) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
