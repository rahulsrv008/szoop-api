import { gridDisk, latLngToCell } from 'h3-js';

/**
 * H3 resolution 8: hexagons ~0.53 km per edge (~0.7 km²) — fine enough to
 * pre-filter a 3–5 km service radius with a plain indexed `IN (...)`.
 */
export const H3_RESOLUTION = 8;

/**
 * Deliberately smaller than the res-8 average edge, so the ring count below
 * errs towards covering a little too much rather than missing a job.
 */
const MIN_EDGE_KM = 0.45;

type Coord = number | string | null | undefined;

function toCoord(value: Coord) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The H3 cell a point falls in, or null when the coordinates are missing/invalid. */
export function h3CellOf(latitude: Coord, longitude: Coord): string | null {
  const lat = toCoord(latitude);
  const lng = toCoord(longitude);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return latLngToCell(lat, lng, H3_RESOLUTION);
}

/**
 * Every H3 cell that may hold a point within `radiusKm` of the origin. This is
 * a superset — callers still apply the exact haversine check afterwards.
 *
 * Cells k rings out have centres at least ~1.5·edge·k away, and both points
 * sit up to one edge from their own cell centre, hence (r + 2·edge) / (1.5·edge).
 */
export function h3CellsWithinKm(latitude: Coord, longitude: Coord, radiusKm: number) {
  const origin = h3CellOf(latitude, longitude);
  if (!origin) return [];
  const rings = Math.ceil((radiusKm + 2 * MIN_EDGE_KM) / (1.5 * MIN_EDGE_KM));
  return gridDisk(origin, rings);
}

/** Straight-line (great-circle) distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
