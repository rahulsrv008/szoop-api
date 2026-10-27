import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { haversineKm } from 'src/common/geo/geo.util';
import { travelMinutes } from 'src/dispatch/dispatch.rules';
import { CustomLoggerService } from 'src/common/utils/logger.service';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RouteEta {
  minutes: number;
  distanceKm: number;
  /** 'google' = live traffic route; 'estimate' = straight line × road factor. */
  source: 'google' | 'estimate';
}

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const ROUTES_TIMEOUT_MS = 4000;

/**
 * Drive time between two points. Uses the Google Routes API (traffic-aware)
 * when MAPS_API_KEY is set, and a distance-based estimate otherwise or when
 * Google is unavailable, so callers always get an answer.
 */
@Injectable()
export class RouteEtaService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: CustomLoggerService,
  ) {}

  async eta(origin: LatLng, destination: LatLng): Promise<RouteEta> {
    const key = this.config.get<string>('MAPS_API_KEY')?.trim();
    if (key) {
      const routed = await this.googleRoute(key, origin, destination);
      if (routed) return routed;
    }
    return estimate(origin, destination);
  }

  private async googleRoute(key: string, origin: LatLng, destination: LatLng): Promise<RouteEta | null> {
    const travelMode = this.config.get<string>('MAPS_TRAVEL_MODE')?.trim() || 'TWO_WHEELER';
    try {
      const response = await fetch(ROUTES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
        },
        body: JSON.stringify({
          origin: { location: { latLng: origin } },
          destination: { location: { latLng: destination } },
          travelMode,
          routingPreference: 'TRAFFIC_AWARE',
        }),
        signal: AbortSignal.timeout(ROUTES_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Google Routes responded ${response.status}`, 'RouteEtaService');
        return null;
      }
      const body = (await response.json()) as {
        routes?: { duration?: string; distanceMeters?: number }[];
      };
      const route = body.routes?.[0];
      const seconds = route?.duration ? parseFloat(route.duration) : NaN;
      if (!route || Number.isNaN(seconds)) return null;
      return {
        minutes: Math.max(1, Math.round(seconds / 60)),
        distanceKm: round1((route.distanceMeters ?? 0) / 1000),
        source: 'google',
      };
    } catch (err) {
      this.logger.warn(
        `Google Routes failed: ${err instanceof Error ? err.message : err}`,
        'RouteEtaService',
      );
      return null;
    }
  }
}

function estimate(origin: LatLng, destination: LatLng): RouteEta {
  const km = haversineKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
  return {
    minutes: Math.max(1, Math.round(travelMinutes(km))),
    distanceKm: round1(km),
    source: 'estimate',
  };
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
