import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ThrottlerStorage,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis, { Cluster } from 'ioredis';

/**
 * Fixed window with an optional block, same contract as the throttler's
 * in-memory store. KEYS: hits, block. ARGV: ttlMs, limit, blockMs.
 * Returns [hits, hitsPttl, blocked(0/1), blockPttl].
 */
const INCREMENT_LUA = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return { tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('PTTL', KEYS[1]), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  local blockMs = tonumber(ARGV[3])
  if blockMs > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', blockMs)
    redis.call('DEL', KEYS[1])
  end
  return { hits, ttl, 1, blockMs }
end
return { hits, ttl, 0, 0 }
`;

/** How long requests may wait for the very first connection after boot (once per process, shared). */
const STARTUP_WAIT_MS = 1000;

type RedisClient = (Redis | Cluster) & {
  rateLimitIncrement(
    hitsKey: string,
    blockKey: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<[number, number, number, number]>;
};

export interface RateLimitStoreStatus {
  /** Where counts are kept right now. */
  store: 'redis' | 'memory';
  /** Redis is configured but currently skipped (unreachable, slow, or still connecting). */
  degraded: boolean;
}

const seconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

const envMs = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Rate-limit counters. Uses Redis when REDIS_URL is set, so every server
 * instance shares one count (Upstash on Vercel, ElastiCache on AWS, Azure
 * Cache for Redis; REDIS_CLUSTER=true for clustered setups). Without
 * REDIS_URL, or while Redis is down or slow, it counts in per-instance memory:
 * limits still apply, just per instance, and a Redis problem never slows the
 * API by more than one short timeout (circuit breaker).
 */
@Injectable()
export class RateLimitStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitStorage.name);
  private readonly memory = new ThrottlerStorageService();
  private readonly breakerMs = envMs('RATE_LIMIT_REDIS_BREAKER_MS', 30_000);
  private readonly redis: RedisClient | null;
  private readonly firstConnection: Promise<void>;
  /** 0 = circuit closed (use Redis). Otherwise Redis is skipped until this time, then one request probes it. */
  private openUntil = 0;
  private probing = false;
  private lastErrorLog = 0;

  constructor() {
    const url = process.env.REDIS_URL?.trim();
    this.redis = url ? this.connect(url) : null;
    this.firstConnection = this.redis ? this.waitForFirstConnection(this.redis) : Promise.resolve();
    if (!this.redis && isDeployed()) {
      this.logger.warn(
        'REDIS_URL is not set: rate limits are counted per server instance. Set REDIS_URL so all instances share one count.',
      );
    }
  }

  status(): RateLimitStoreStatus {
    if (!this.redis) return { store: 'memory', degraded: false };
    const usable = this.openUntil === 0 && this.redis.status === 'ready';
    return { store: usable ? 'redis' : 'memory', degraded: !usable };
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const attempt = this.redis ? await this.redisAttempt() : 'skip';
    if (attempt !== 'skip') {
      try {
        // {...} is a Redis Cluster hash tag: both keys land on the same node,
        // which a multi-key script requires. Harmless on a single Redis.
        const [hits, hitsTtl, blocked, blockTtl] = await this.redis!.rateLimitIncrement(
          `{${key}}`,
          `{${key}}:block`,
          ttl,
          limit,
          blockDuration,
        );
        if (attempt === 'probe') this.closeCircuit();
        return {
          totalHits: hits,
          timeToExpire: seconds(hitsTtl),
          isBlocked: blocked === 1,
          timeToBlockExpire: seconds(blockTtl),
        };
      } catch (err) {
        this.openCircuit(err as Error);
      } finally {
        if (attempt === 'probe') this.probing = false;
      }
    }
    return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  async onModuleDestroy() {
    this.memory.onApplicationShutdown();
    if (!this.redis) return;
    // quit() waits for the server; with no connection it would hang shutdown.
    if (this.redis.status === 'ready') await this.redis.quit().catch(() => undefined);
    else this.redis.disconnect();
  }

  /** 'use' while the circuit is closed, 'probe' for the one request that retries Redis after a pause, else 'skip'. */
  private async redisAttempt(): Promise<'use' | 'probe' | 'skip'> {
    await this.firstConnection; // already settled after the first second of the process
    if (this.openUntil === 0) return 'use';
    if (Date.now() < this.openUntil || this.probing) return 'skip';
    this.probing = true;
    return 'probe';
  }

  private openCircuit(err: Error) {
    const wasClosed = this.openUntil === 0;
    this.openUntil = Date.now() + this.breakerMs;
    if (wasClosed || Date.now() - this.lastErrorLog > 60_000) {
      this.lastErrorLog = Date.now();
      this.logger.error(
        `Redis unavailable (${err.message}): counting rate limits in memory, retrying Redis in ${Math.round(this.breakerMs / 1000)}s`,
      );
    }
  }

  private closeCircuit() {
    if (this.openUntil === 0) return;
    this.openUntil = 0;
    this.logger.log('Redis is back: rate limits are shared across instances again');
  }

  private connect(url: string): RedisClient {
    const options = {
      connectTimeout: 2000,
      // A Redis in the same region answers in ~1 ms; anything slower is treated as down.
      commandTimeout: envMs('RATE_LIMIT_REDIS_TIMEOUT_MS', 100),
      maxRetriesPerRequest: 1,
    };
    let client: Redis | Cluster;
    if ((process.env.REDIS_CLUSTER ?? '').toLowerCase() === 'true') {
      const parsed = new URL(url);
      client = new Cluster([{ host: parsed.hostname, port: Number(parsed.port) || 6379 }], {
        enableOfflineQueue: false,
        // ElastiCache with TLS: connect by hostname so the certificate matches.
        dnsLookup: (address, callback) => callback(null, address),
        redisOptions: {
          ...options,
          username: decodeURIComponent(parsed.username) || undefined,
          password: decodeURIComponent(parsed.password) || undefined,
          tls: parsed.protocol === 'rediss:' ? {} : undefined,
        },
      });
    } else {
      // No offline queue: while disconnected, commands fail at once instead of piling up.
      client = new Redis(url, { ...options, enableOfflineQueue: false });
    }
    // Sent once, then called by SHA (EVALSHA) instead of shipping the script every request.
    client.defineCommand('rateLimitIncrement', { numberOfKeys: 2, lua: INCREMENT_LUA });
    client.on('error', (err: Error) => this.logConnectionError(err));
    // Reconnected after an outage: use Redis again right away instead of waiting out the breaker.
    client.on('ready', () => this.closeCircuit());
    return client as RedisClient;
  }

  private waitForFirstConnection(client: RedisClient) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, STARTUP_WAIT_MS);
      timer.unref?.();
      client.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private logConnectionError(err: Error) {
    // ioredis reports every reconnect attempt; one line a minute is enough.
    if (Date.now() - this.lastErrorLog < 60_000) return;
    this.lastErrorLog = Date.now();
    this.logger.error(`Redis connection error: ${err.message}`);
  }
}

function isDeployed() {
  const env = (process.env.NODE_ENV || '').toLowerCase();
  return env === 'production' || env === 'staging';
}
