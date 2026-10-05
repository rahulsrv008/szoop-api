import { Agent, Booking, CustomerAddress } from 'src/database/entities';
import { haversineKm } from 'src/common/geo/geo.util';

/** A GPS fix older than this no longer says where the agent is, so it can't qualify jobs by distance. */
export const LOCATION_MAX_AGE_MINUTES = 30;

/** Travel time kept free between two jobs held by the same agent. */
export const TRAVEL_BUFFER_MINUTES = 30;

/** Fallback slot length when a booking carries neither a duration nor an end time. */
const DEFAULT_SLOT_MINUTES = 60;

/**
 * Statuses in which an agent is committed to a booking's time slot. 'paid'
 * with an agent set is the moment between claiming a job and accepting it.
 */
export const COMMITTED_STATUSES: Booking['status'][] = ['paid', 'accepted', 'arriving', 'ongoing'];

/** Statuses an agent can be pulled off (released or no-show) before work starts. */
export const RELEASABLE_STATUSES: Booking['status'][] = ['accepted', 'arriving'];

/** A job can still be dispatched/accepted this long after its start: late beats nobody. */
export const LATE_JOB_WINDOW_MINUTES = 60;

/** An accepted job with no "arrived" by start + this is treated as a no-show and re-dispatched. */
export const NO_SHOW_GRACE_MINUTES = 20;

/**
 * A multi-visit plan only has to fit an agent's schedule for its first this
 * many days to be offered to them: nobody's calendar is known a month out,
 * and one unavailable day in week 4 shouldn't hide the plan from everyone.
 */
export const PLAN_FIT_DAYS = 7;

/** An agent can't hand back a job themselves this close to its start; support has to. */
export const RELEASE_CUTOFF_MINUTES = 120;

/** At most this many self-releases (no-shows included) per agent in RELEASE_WINDOW_DAYS. */
export const MAX_RELEASES_PER_WINDOW = 3;
export const RELEASE_WINDOW_DAYS = 30;

/** Jobs starting sooner than this only go to agents with a live fix who can get there in time. */
export const NEAR_TERM_MINUTES = 120;

/** Rough city travel: road distance ≈ 1.3 × straight line, at ~20 km/h. */
const ROAD_FACTOR = 1.3;
const CITY_SPEED_KMH = 20;
/** Arriving this many minutes late still counts as making it. */
const ARRIVAL_TOLERANCE_MINUTES = 10;

/**
 * Push dispatch widens the search each time a wave goes unanswered:
 * a few nearby agents first, then further out, before giving up.
 */
export const DISPATCH_WAVES = [
  { radiusKm: 3, size: 3 },
  { radiusKm: 5, size: 3 },
  { radiusKm: 8, size: 5 },
] as const;

/** How long an agent has to answer an offer before the next wave goes out. */
export const OFFER_TTL_SECONDS = 90;

/** Once every wave ran dry, how often to look again for agents who came online since. */
export const EXHAUSTED_RETRY_MINUTES = 10;

export type GeoPoint = { lat: number; lng: number };

/** The agent's last GPS fix; with `maxAgeMinutes`, an older fix counts as unknown. */
export function agentOrigin(agent: Agent, maxAgeMinutes?: number): GeoPoint | null {
  const fix = agent.currentLocation;
  if (!fix) return null;
  if (maxAgeMinutes !== undefined) {
    const ageMs = Date.now() - new Date(fix.recordedAt).getTime();
    if (!(ageMs <= maxAgeMinutes * 60_000)) return null;
  }
  return toPoint(fix.latitude, fix.longitude);
}

/**
 * Where to measure an agent's distance from: a fresh GPS fix when there is
 * one, otherwise their registered home address (agents mostly work near home,
 * and the app may not ping while backgrounded).
 */
export function agentBase(agent: Agent): { point: GeoPoint; live: boolean } | null {
  const fix = agentOrigin(agent, LOCATION_MAX_AGE_MINUTES);
  if (fix) return { point: fix, live: true };
  const home = toPoint(agent.latitude, agent.longitude);
  return home ? { point: home, live: false } : null;
}

/** Estimated minutes to travel `km` straight-line across the city. */
export function travelMinutes(km: number) {
  return ((km * ROAD_FACTOR) / CITY_SPEED_KMH) * 60;
}

/** Whether someone `km` away can arrive by the start (with a little tolerance). */
export function canReachInTime(km: number, minutesToStart: number) {
  return travelMinutes(km) <= minutesToStart + ARRIVAL_TOLERANCE_MINUTES;
}

export function minutesUntil(date: Date, now = new Date()) {
  return (date.getTime() - now.getTime()) / 60_000;
}

/** Straight-line km from a point to the booking address, when both are known. */
export function distanceKm(origin: GeoPoint | null, address: CustomerAddress | null | undefined) {
  const target = address ? toPoint(address.latitude, address.longitude) : null;
  if (!origin || !target) return null;
  return haversineKm(origin.lat, origin.lng, target.lat, target.lng);
}

export function serviceNames(booking: Booking) {
  const names = (booking.items ?? [])
    .map((item) => item.service?.name)
    .filter((name): name is string => !!name);
  return names.length || !booking.planTitle ? names : [booking.planTitle];
}

/** On Demand is general help by the hour, so any approved agent can take it. */
export function hasSkillFor(booking: Booking, keywords: string[]) {
  return (
    booking.planType === 'HOURLY' ||
    serviceNames(booking).some((name) => matchesSkill(name, keywords))
  );
}

export function servesZone(agent: Agent, zoneId: string | null) {
  return (
    !!zoneId &&
    (agent.homeZoneId === zoneId || (agent.serviceAreas ?? []).includes(zoneId))
  );
}

/** 'HH:MM[:SS]' → minutes since midnight. */
export function toMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + (minutes || 0);
}

export function slotMinutes(booking: Booking) {
  if (booking.durationMinutes > 0) return booking.durationMinutes;
  if (booking.endTime) {
    const length = toMinutes(booking.endTime) - toMinutes(booking.startTime);
    if (length > 0) return length;
  }
  return DEFAULT_SLOT_MINUTES;
}

function matchesSkill(serviceName: string, keywords: string[]) {
  const haystack = serviceName.toLowerCase();
  return keywords.some(
    (keyword) => haystack.includes(keyword) || keyword.includes(haystack),
  );
}

function toPoint(latitude: unknown, longitude: unknown): GeoPoint | null {
  if (latitude == null || longitude == null) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
