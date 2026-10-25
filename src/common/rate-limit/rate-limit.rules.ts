const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface RateLimitRule {
  /** Counter name; routes sharing a bucket share one count. */
  bucket: string;
  limit: number;
  ttl: number;
  /** How long a client stays blocked once over the limit. Defaults to `ttl`. */
  blockDuration?: number;
  /**
   * `ip` for pre-login routes, so an attacker can't get fresh counters by
   * attaching different tokens. `user` counts per signed-in account (falls
   * back to IP when there's no valid token).
   */
  by: 'ip' | 'user';
}

/**
 * Per-route limits, on top of the global floor (RATE_LIMIT_GLOBAL_*).
 * See docs/rate-limiting.md for the reasoning behind each number.
 */
export const RATE_LIMITS = {
  OTP_SEND: { bucket: 'otp-send', limit: 20, ttl: 15 * MINUTE, by: 'ip' },
  OTP_VERIFY: { bucket: 'otp-verify', limit: 30, ttl: 15 * MINUTE, by: 'ip' },
  ADMIN_LOGIN: { bucket: 'admin-login', limit: 20, ttl: 15 * MINUTE, by: 'ip' },
  ADMIN_CHANGE_PASSWORD: { bucket: 'admin-change-password', limit: 5, ttl: 15 * MINUTE, by: 'user' },
  ADMIN_BROADCAST: { bucket: 'admin-broadcast', limit: 5, ttl: MINUTE, by: 'user' },
  BOOKING_CREATE: { bucket: 'booking-create', limit: 10, ttl: HOUR, by: 'user' },
  BOOKING_CHANGE: { bucket: 'booking-change', limit: 20, ttl: HOUR, by: 'user' },
  PAYMENT_CREATE: { bucket: 'payment-create', limit: 20, ttl: HOUR, by: 'user' },
  SUPPORT_TICKET: { bucket: 'support-ticket', limit: 5, ttl: HOUR, by: 'user' },
  RATING: { bucket: 'rating', limit: 20, ttl: HOUR, by: 'user' },
  DEVICE_TOKEN: { bucket: 'device-token', limit: 10, ttl: HOUR, by: 'user' },
  AGENT_LOCATION: { bucket: 'agent-location', limit: 30, ttl: MINUTE, by: 'user' },
  AGENT_DOCUMENT: { bucket: 'agent-document', limit: 20, ttl: HOUR, by: 'user' },
  CITY_WAITLIST: { bucket: 'city-waitlist', limit: 10, ttl: HOUR, by: 'user' },
  ACCOUNT_DELETION: { bucket: 'account-deletion', limit: 5, ttl: HOUR, by: 'ip' },
  ACCOUNT_DELETE: { bucket: 'account-delete', limit: 3, ttl: HOUR, by: 'user' },
} satisfies Record<string, RateLimitRule>;

/** Per-account / per-number limits enforced in services (not by IP). */
export const ADMIN_LOGIN_PER_EMAIL = { limit: 10, ttl: 15 * MINUTE };
export const CITY_WAITLIST_MAX_CITIES = 10;
