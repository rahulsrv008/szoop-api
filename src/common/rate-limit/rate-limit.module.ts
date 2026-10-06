import { ExecutionContext, Global, Inject, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModule,
  ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { TokenService } from 'src/common/auth/token.service';
import { RATE_LIMIT_RULE } from './rate-limit.decorator';
import { RateLimitRule } from './rate-limit.rules';
import { RateLimitStorage } from './rate-limit.storage';
import { RateLimitStats } from './rate-limit.stats';

type Req = { ip?: string; socket?: { remoteAddress?: string }; headers: Record<string, string | undefined> };

const num = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const ruleOf = (context: ExecutionContext): RateLimitRule | undefined =>
  Reflect.getMetadata(RATE_LIMIT_RULE, context.getHandler());

/**
 * The client's IP as Express sees it (respecting TRUST_PROXY). IPv6 is cut to
 * its /64, since one device can rotate freely inside it.
 */
export function clientIp(req: Req): string {
  let ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).join(':')}::/64`;
}

export function rateLimitTracker(tokens: TokenService) {
  return (req: Req): string => {
    const header = req.headers?.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        // Verified, so a forged token can't pick someone else's counter.
        return `user:${tokens.verifyAccessToken(header.slice(7)).sub}`;
      } catch {
        // Invalid or expired: count by IP; the auth guard rejects it anyway.
      }
    }
    return `ip:${clientIp(req)}`;
  };
}

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  @Inject(RateLimitStats) private readonly stats!: RateLimitStats;

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const http = context.switchToHttp();
    const req = http.getRequest<Req & { method: string; originalUrl?: string }>();
    // The library names it `Retry-After-<throttler>`; clients expect the standard header too.
    http.getResponse<{ header: (k: string, v: unknown) => void }>().header('Retry-After', detail.timeToBlockExpire);
    // Keys look like rl:<bucket>:<client>.
    this.stats.record(detail.key.split(':')[1] ?? 'unknown', detail.tracker, `${req.method} ${req.originalUrl}`);
    return super.throwThrottlingException(context, detail);
  }
}

/** One storage instance (one Redis connection) for the guard and for services. */
@Global()
@Module({ providers: [RateLimitStorage, RateLimitStats], exports: [RateLimitStorage, RateLimitStats] })
export class RateLimitStorageModule {}

/**
 * Two counters per request:
 *  - `global`: every route, per signed-in account or per IP (the floor).
 *  - `route`:  only routes decorated with @RateLimit(), with their own bucket.
 */
@Module({
  imports: [
    RateLimitStorageModule,
    ThrottlerModule.forRootAsync({
      imports: [RateLimitStorageModule],
      inject: [RateLimitStorage, TokenService],
      useFactory: (storage: RateLimitStorage, tokens: TokenService): ThrottlerModuleOptions => {
        const track = rateLimitTracker(tokens);
        const enabled = (process.env.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() !== 'false';
        return {
          storage,
          errorMessage: 'Too many requests. Please wait a moment and try again.',
          skipIf: () => !enabled,
          throttlers: [
            {
              name: 'global',
              limit: num('RATE_LIMIT_GLOBAL_LIMIT', 300),
              ttl: num('RATE_LIMIT_GLOBAL_TTL_MS', 60_000),
              getTracker: (req) => track(req as Req),
              generateKey: (_ctx, tracker) => `rl:global:${tracker}`,
            },
            {
              name: 'route',
              limit: Number.MAX_SAFE_INTEGER,
              ttl: 60_000,
              skipIf: (ctx) => !ruleOf(ctx),
              getTracker: (req, ctx) =>
                ruleOf(ctx)?.by === 'ip' ? `ip:${clientIp(req as Req)}` : track(req as Req),
              generateKey: (ctx, tracker) => `rl:${ruleOf(ctx)?.bucket}:${tracker}`,
            },
          ],
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class RateLimitModule {}
