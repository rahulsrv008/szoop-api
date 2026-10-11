import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CustomLoggerService } from 'src/common/utils/logger.service';
import { LatLng, RouteEta, RouteEtaService } from './route-eta.service';

/** Created at boot like the dispatch tables. Idempotent. */
const BOOKING_ETA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS booking_etas (
  booking_id UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  eta_minutes INT NOT NULL,
  distance_km DECIMAL(7, 1) NOT NULL,
  source VARCHAR(12) NOT NULL,
  origin_latitude DECIMAL(10, 7) NOT NULL,
  origin_longitude DECIMAL(10, 7) NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

/** A fresh route is fetched at most this often per booking while the customer watches. */
const REFRESH_AFTER_MS = 2 * 60_000;

export interface BookingEta extends RouteEta {
  computedAt: Date;
  /** Minutes left now: the routed time minus what has passed since it was computed. */
  remainingMinutes: number;
}

/**
 * The agent's drive time to the customer for a booking, computed when they
 * set off and refreshed (throttled) as new GPS pings arrive.
 */
@Injectable()
export class BookingEtaService implements OnModuleInit {
  private ready = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly routes: RouteEtaService,
    private readonly logger: CustomLoggerService,
  ) {}

  async onModuleInit() {
    await this.ensureTable();
  }

  /** Route from `origin` now and store it as the booking's ETA. */
  async refresh(bookingId: string, origin: LatLng, destination: LatLng): Promise<BookingEta> {
    const eta = await this.routes.eta(origin, destination);
    const computedAt = new Date();
    if (await this.ensureTable()) {
      await this.dataSource
        .query(
          `INSERT INTO booking_etas
             (booking_id, eta_minutes, distance_km, source, origin_latitude, origin_longitude, computed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (booking_id) DO UPDATE SET
             eta_minutes = EXCLUDED.eta_minutes,
             distance_km = EXCLUDED.distance_km,
             source = EXCLUDED.source,
             origin_latitude = EXCLUDED.origin_latitude,
             origin_longitude = EXCLUDED.origin_longitude,
             computed_at = EXCLUDED.computed_at`,
          [bookingId, eta.minutes, eta.distanceKm, eta.source, origin.latitude, origin.longitude, computedAt],
        )
        .catch((err) => this.logger.warn(`Saving ETA failed: ${err.message}`, 'BookingEtaService'));
    }
    return { ...eta, computedAt, remainingMinutes: eta.minutes };
  }

  async latest(bookingId: string): Promise<BookingEta | null> {
    if (!(await this.ensureTable())) return null;
    const [row] = await this.dataSource.query(
      `SELECT eta_minutes, distance_km, source, computed_at FROM booking_etas WHERE booking_id = $1`,
      [bookingId],
    );
    if (!row) return null;
    const computedAt = new Date(row.computed_at);
    const elapsed = (Date.now() - computedAt.getTime()) / 60_000;
    return {
      minutes: row.eta_minutes,
      distanceKm: Number(row.distance_km),
      source: row.source,
      computedAt,
      remainingMinutes: Math.max(1, Math.round(row.eta_minutes - elapsed)),
    };
  }

  /** The stored ETA, re-routed when it is stale and the agent has pinged since. */
  async current(
    bookingId: string,
    origin: (LatLng & { recordedAt: Date }) | null,
    destination: LatLng | null,
  ): Promise<BookingEta | null> {
    const stored = await this.latest(bookingId);
    if (!origin || !destination) return stored;
    const stale =
      !stored ||
      (Date.now() - stored.computedAt.getTime() > REFRESH_AFTER_MS &&
        origin.recordedAt.getTime() > stored.computedAt.getTime());
    return stale ? this.refresh(bookingId, origin, destination) : stored;
  }

  private async ensureTable() {
    if (this.ready) return true;
    try {
      await this.dataSource.query(BOOKING_ETA_SCHEMA_SQL);
      this.ready = true;
    } catch (err) {
      this.logger.error(
        `Failed to ensure booking_etas table: ${err instanceof Error ? err.message : err}`,
        'BookingEtaService',
      );
    }
    return this.ready;
  }
}
