import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { RateLimitRule } from './rate-limit.rules';

export const RATE_LIMIT_RULE = 'rate-limit:rule';

/** Adds a route-specific limit on top of the global floor. */
export const RateLimit = (rule: RateLimitRule) =>
  applyDecorators(
    SetMetadata(RATE_LIMIT_RULE, rule),
    Throttle({
      route: { limit: rule.limit, ttl: rule.ttl, blockDuration: rule.blockDuration ?? rule.ttl },
    }),
    ApiTooManyRequestsResponse({
      description: `Over ${rule.limit} requests per ${Math.round(rule.ttl / 60_000)} min (per ${rule.by === 'ip' ? 'IP' : 'account'}). See Retry-After.`,
    }),
  );

/** Webhooks, cron and health checks: never limited. */
export const NoRateLimit = () => SkipThrottle({ global: true, route: true });
