import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo, createServer } from 'net';
import { NestFactory } from '@nestjs/core';
import Redis from 'ioredis';
import { Factory, Harness, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { TokenService } from 'src/common/auth/token.service';
import { clientIp } from 'src/common/rate-limit/rate-limit.module';
import { RateLimitStorage } from 'src/common/rate-limit/rate-limit.storage';
import { RateLimitStats } from 'src/common/rate-limit/rate-limit.stats';

// A small floor so the global limit is cheap to hit; set before the app boots.
process.env.RATE_LIMIT_GLOBAL_LIMIT = '40';
process.env.RATE_LIMIT_GLOBAL_TTL_MS = '60000';
process.env.OTP_DEMO_MODE = 'true'; // code is always 1111, no SMS

let ipSeq = 0;
/** Each scenario pretends to be its own client via X-Forwarded-For. */
const newIp = () => `203.0.113.${++ipSeq}`;

describe('Rate limiting', () => {
  let h: Harness;
  let base: string;
  let f: Factory;

  before(async () => {
    delete process.env.REDIS_URL;
    h = await startApp();
    h.app.getHttpAdapter().getInstance().set('trust proxy', true);
    await h.app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}`;
    f = new Factory(h);
  });
  after(() => h.close());

  const call = (method: string, path: string, ip: string, body?: unknown, token?: string) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        'x-forwarded-for': ip,
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const tokenFor = async () => {
    const { user, customer } = await f.customer();
    return (
      await h.get(TokenService).issueSession({ sub: user.id, role: 'customer', customerId: customer.id } as never)
    ).accessToken;
  };

  describe('global floor', () => {
    it('blocks one IP after the limit with 429 + Retry-After, and leaves other IPs alone', async () => {
      const ip = newIp();
      for (let i = 0; i < 40; i++) assert.equal((await call('GET', '/customer/home', ip)).status, 200);
      const blocked = await call('GET', '/customer/home', ip);
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
      assert.match((await blocked.json()).message, /Too many requests/);
      assert.equal((await call('GET', '/customer/home', newIp())).status, 200);
      // Counted for the per-minute summary rather than logged one line each.
      assert.ok((h.get(RateLimitStats).snapshot().global ?? 0) >= 1);
    });

    it('counts signed-in users per account, not per shared IP', async () => {
      const ip = newIp();
      const [a, b] = [await tokenFor(), await tokenFor()];
      for (let i = 0; i < 40; i++) await call('GET', '/customer/home', ip, undefined, a);
      assert.equal((await call('GET', '/customer/home', ip, undefined, a)).status, 429);
      assert.equal((await call('GET', '/customer/home', ip, undefined, b)).status, 200);
      assert.equal((await call('GET', '/customer/home', ip)).status, 200);
    });

    it('never limits health checks', async () => {
      const ip = newIp();
      for (let i = 0; i < 45; i++) {
        assert.equal((await call('GET', '/health', ip)).status, 200);
      }
    });
  });

  describe('OTP', () => {
    it('allows only 5 guesses per code even when sent in parallel', async () => {
      const mobile = '9700000001';
      assert.equal((await call('POST', '/customer/auth/send-otp', newIp(), { mobile })).status, 200);
      const guesses = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          call('POST', '/customer/auth/verify-otp', newIp(), { mobile, otp: String(2000 + i) }).then((r) => r.json()),
        ),
      );
      const checked = guesses.filter((g) => /Invalid OTP/.test(g.message)).length;
      assert.equal(checked, 5, `expected exactly 5 guesses checked, got ${checked}`);
      // The real code is useless now too.
      const right = await call('POST', '/customer/auth/verify-otp', newIp(), { mobile, otp: '1111' });
      assert.equal(right.status, 401);
    });

    it('lets a code log in only once, even with parallel correct submissions', async () => {
      const mobile = '9700000002';
      await call('POST', '/customer/auth/send-otp', newIp(), { mobile });
      const results = await Promise.all(
        Array.from({ length: 5 }, () => call('POST', '/customer/auth/verify-otp', newIp(), { mobile, otp: '1111' })),
      );
      assert.equal(results.filter((r) => r.status === 200).length, 1);
    });

    const pastOtp = (mobile: string, minutesAgo: number, attempts = 0) =>
      h.ds.query(
        `INSERT INTO otp_verifications (mobile, otp_hash, purpose, attempts, expires_at, created_at)
         VALUES ($1, 'x', 'customer_login', $2, NOW() - INTERVAL '1 minute', NOW() - ($3 || ' minutes')::interval)`,
        [mobile, attempts, String(minutesAgo)],
      );

    it('caps sends per number per hour and per day, across IPs', async () => {
      const hourly = '9700000003';
      for (let i = 0; i < 5; i++) await pastOtp(hourly, 10 + i);
      const res = await call('POST', '/customer/auth/send-otp', newIp(), { mobile: hourly });
      assert.equal(res.status, 429);
      assert.match((await res.json()).message, /Too many OTP requests for this number/);

      const daily = '9700000004';
      for (let i = 0; i < 10; i++) await pastOtp(daily, 120 + i * 60);
      assert.equal((await call('POST', '/agent/auth/send-otp', newIp(), { mobile: daily })).status, 429);
    });

    it('locks a number for an hour after 10 wrong guesses across codes', async () => {
      const mobile = '9700000005';
      await pastOtp(mobile, 30, 5);
      await pastOtp(mobile, 20, 5);
      const send = await call('POST', '/customer/auth/send-otp', newIp(), { mobile });
      assert.equal(send.status, 429);
      assert.match((await send.json()).message, /Too many wrong OTP attempts/);
      assert.equal(
        (await call('POST', '/customer/auth/verify-otp', newIp(), { mobile, otp: '1111' })).status,
        429,
      );
    });

    it('limits OTP sends per IP across different numbers', async () => {
      const ip = newIp();
      for (let i = 0; i < 20; i++) {
        const res = await call('POST', '/customer/auth/send-otp', ip, { mobile: `96000000${String(i).padStart(2, '0')}` });
        assert.equal(res.status, 200, `send ${i + 1}`);
      }
      const blocked = await call('POST', '/customer/auth/send-otp', ip, { mobile: '9600000099' });
      assert.equal(blocked.status, 429);
      assert.equal((await call('POST', '/customer/auth/send-otp', newIp(), { mobile: '9600000099' })).status, 200);
    });
  });

  describe('admin login', () => {
    it('blocks an account after 10 attempts even when each comes from a new IP', async () => {
      const email = 'target@clearit.test';
      for (let i = 0; i < 10; i++) {
        const res = await call('POST', '/admin/auth/login', newIp(), { email, password: `guess-${i}` });
        assert.equal(res.status, 401);
      }
      const blocked = await call('POST', '/admin/auth/login', newIp(), { email, password: 'guess-x' });
      assert.equal(blocked.status, 429);
      assert.match((await blocked.json()).message, /Too many login attempts for this account/);
    });

    it('limits one IP trying many accounts', async () => {
      const ip = newIp();
      for (let i = 0; i < 20; i++) {
        await call('POST', '/admin/auth/login', ip, { email: `spray${i}@clearit.test`, password: 'Password1!' });
      }
      assert.equal(
        (await call('POST', '/admin/auth/login', ip, { email: 'spray99@clearit.test', password: 'Password1!' })).status,
        429,
      );
    });
  });

  describe('signed-in route limits', () => {
    it('caps "Notify me" per account and the number of cities followed', async () => {
      const token = await tokenFor();
      const cities = ['Agra', 'Jaipur', 'Lucknow', 'Varanasi', 'Kanpur', 'Mathura', 'Amritsar', 'Indore', 'Bhopal', 'Pune'];
      for (const city of cities) {
        assert.equal((await call('POST', '/customer/serviceability/notify', newIp(), { city }, token)).status, 200);
      }
      // 11th call in the hour: route limit (10/hour per account) answers first.
      assert.equal((await call('POST', '/customer/serviceability/notify', newIp(), { city: 'Udaipur' }, token)).status, 429);
    });

    it('rejects an 11th city even when the rate limit allows it', async () => {
      const token = await tokenFor();
      const customerId = (h.get(TokenService).verifyAccessToken(token) as unknown as { customerId: string }).customerId;
      for (let i = 0; i < 10; i++) {
        await h.repo(E.CityWaitlist).save({ customerId, cityKey: `town${i}`, city: `Town${i}` } as Partial<E.CityWaitlist>);
      }
      const res = await call('POST', '/customer/serviceability/notify', newIp(), { city: 'Agra' }, token);
      assert.equal(res.status, 400);
      assert.match((await res.json()).message, /up to 10 cities/);
    });
  });

  it('keys IPv6 clients by their /64 so address rotation does not reset the count', () => {
    assert.equal(clientIp({ ip: '2405:201:abcd:12::1', headers: {} }), '2405:201:abcd:12::/64');
    assert.equal(clientIp({ ip: '2405:201:abcd:12:aaaa:bbbb:cccc:dddd', headers: {} }), '2405:201:abcd:12::/64');
    assert.equal(clientIp({ ip: '::ffff:49.36.1.2', headers: {} }), '49.36.1.2');
  });
});

/** Shared counters across server instances. Needs a real Redis: TEST_REDIS_URL=redis://127.0.0.1:6379/15 */
describe('Rate limiting with Redis', { skip: !process.env.TEST_REDIS_URL && 'set TEST_REDIS_URL to run' }, () => {
  it('two servers share one count, and a dead Redis falls back to memory', async () => {
    const url = process.env.TEST_REDIS_URL!;
    const admin = new Redis(url, { maxRetriesPerRequest: 1 });
    admin.on('error', () => undefined);
    await admin.flushdb();

    process.env.REDIS_URL = url;
    const h1 = await startApp();
    const { AppModule } = await import('src/app.module');
    const app2 = await NestFactory.create(AppModule, { logger: ['error'] });
    await app2.init();
    process.env.REDIS_URL = 'redis://127.0.0.1:1'; // nothing listens here
    const app3 = await NestFactory.create(AppModule, { logger: false });
    await app3.init();

    const servers = await Promise.all(
      [h1.app, app2, app3].map(async (app) => {
        app.getHttpAdapter().getInstance().set('trust proxy', true);
        await app.listen(0, '127.0.0.1');
        return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
      }),
    );
    const hit = (server: string) =>
      fetch(`${server}/customer/home`, { headers: { 'x-forwarded-for': '198.51.100.7' } }).then((r) => r.status);

    try {
      for (let i = 0; i < 20; i++) assert.equal(await hit(servers[0]), 200);
      for (let i = 0; i < 20; i++) assert.equal(await hit(servers[1]), 200);
      assert.equal(await hit(servers[1]), 429, '41st request across both servers is blocked');
      assert.equal(await hit(servers[0]), 429);
      const keys = await admin.keys('{rl:global:*');
      assert.ok(keys.some((k) => k.includes('198.51.100.7')));

      // Redis unreachable: the API still answers, limited per instance.
      for (let i = 0; i < 40; i++) assert.equal(await hit(servers[2]), 200);
      assert.equal(await hit(servers[2]), 429);
    } finally {
      delete process.env.REDIS_URL;
      await Promise.all([h1.close(), app2.close(), app3.close(), admin.quit()]);
    }
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Builds a storage the way the app does, from env, then restores env. */
function storageWith(env: Record<string, string>) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const storage = new RateLimitStorage();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return storage;
}

const hit = (s: RateLimitStorage, key: string, limit = 1000) => s.increment(key, 60_000, limit, 60_000, 'global');

describe('Redis problems never slow requests down', () => {
  it('a hung Redis costs one short wait at startup, not one per request', async () => {
    const hung = createServer(() => undefined).listen(0); // accepts connections, never answers
    await new Promise((resolve) => hung.once('listening', resolve));
    const storage = storageWith({ REDIS_URL: `redis://127.0.0.1:${(hung.address() as AddressInfo).port}` });
    try {
      const started = Date.now();
      for (let i = 0; i < 20; i++) await hit(storage, 'hung');
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 1500, `20 requests took ${elapsed} ms (was ~1 s each before the circuit breaker)`);
      assert.equal((await hit(storage, 'hung')).totalHits, 21, 'still counted, in memory');
      assert.deepEqual(storage.status(), { store: 'memory', degraded: true });
    } finally {
      await storage.onModuleDestroy();
      hung.close();
    }
  });

  it('a stalled Redis costs one 100 ms timeout, then is skipped until it recovers', { skip: !process.env.TEST_REDIS_URL && 'set TEST_REDIS_URL to run' }, async () => {
    const admin = new Redis(process.env.TEST_REDIS_URL!, { maxRetriesPerRequest: 1 });
    admin.on('error', () => undefined);
    const storage = storageWith({ REDIS_URL: process.env.TEST_REDIS_URL!, RATE_LIMIT_REDIS_BREAKER_MS: '1000' });
    try {
      await hit(storage, 'stall');
      assert.deepEqual(storage.status(), { store: 'redis', degraded: false });

      await admin.call('CLIENT', 'PAUSE', '1500', 'ALL'); // every command waits 1.5 s
      const started = Date.now();
      for (let i = 0; i < 10; i++) await hit(storage, 'stall');
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 400, `10 requests took ${elapsed} ms (was 500 ms each before)`);
      assert.equal(storage.status().degraded, true);

      await sleep(1700); // pause over and breaker window passed
      await hit(storage, 'stall'); // the probe goes back to Redis
      assert.deepEqual(storage.status(), { store: 'redis', degraded: false });
    } finally {
      await storage.onModuleDestroy();
      await admin.quit();
    }
  });
});

/** Needs a Redis Cluster: TEST_REDIS_CLUSTER_URL=redis://127.0.0.1:7001 */
describe('Rate limiting on Redis Cluster', { skip: !process.env.TEST_REDIS_CLUSTER_URL && 'set TEST_REDIS_CLUSTER_URL to run' }, () => {
  it('keeps each counter and its block key on one node, and servers share counts', async () => {
    const env = { REDIS_URL: process.env.TEST_REDIS_CLUSTER_URL!, REDIS_CLUSTER: 'true' };
    const [a, b] = [storageWith(env), storageWith(env)];
    try {
      const key = `rl:global:ip:192.0.2.${Date.now() % 250}`;
      for (let i = 0; i < 10; i++) {
        assert.equal((await hit(i % 2 ? b : a, key, 10)).isBlocked, false);
      }
      assert.equal((await hit(a, key, 10)).isBlocked, true, '11th hit across both servers is blocked');
      assert.equal((await hit(b, key, 10)).isBlocked, true);

      // Many keys spread over every node and slot: none may fall back to memory.
      for (let i = 0; i < 200; i++) await hit(a, `rl:global:user:cluster-${i}`);
      assert.deepEqual(a.status(), { store: 'redis', degraded: false });
      assert.deepEqual(b.status(), { store: 'redis', degraded: false });
    } finally {
      await Promise.all([a.onModuleDestroy(), b.onModuleDestroy()]);
    }
  });
});
