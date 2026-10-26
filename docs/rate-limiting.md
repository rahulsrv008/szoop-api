# Rate limiting

How the API limits abuse: what's limited, why, how it's configured on each host, and what's still open.

**Code:** `src/common/rate-limit/` (guard, rules, storage) and `src/common/auth/otp.service.ts` (per-number OTP limits).
**Tests:** `test/e2e/06-rate-limiting.e2e.ts`.

---

## 1. Three layers

| Layer | Applies to | Counted by | Stored in |
|---|---|---|---|
| **Global floor** | Every route | Signed-in account, else client IP | Redis (or memory) |
| **Route rules** | Routes with `@RateLimit(...)` | IP for pre-login routes, account for the rest | Redis (or memory) |
| **Per-account rules** | OTP per phone number, admin login per email, "Notify me" city cap | Phone number / email / customer | OTP and city cap: **Postgres**. Admin email: Redis (or memory) |

A request has to pass every layer that applies. Each block returns **HTTP 429** with a human-readable `message` and a `Retry-After` header (seconds).

Why three layers and not one global limit: a limit loose enough for normal app use (a single app launch makes a dozen calls) is far too loose for SMS sends or password guesses. Those need limits around 5 per hour, keyed on the phone number or account, not the IP.

---

## 2. How clients are identified

- **Signed-in requests** are counted per account (`user:<id>`). The bearer token is **verified** first, so a forged token can't pick someone else's counter. Invalid or expired tokens are counted by IP.
- **Everything else** is counted per client IP (`ip:<address>`).
- **Pre-login routes** (OTP, admin login) always count by IP, even when a token is attached. Otherwise an attacker could get fresh counters by rotating tokens.
- **IPv6** addresses are cut to their `/64`. One phone can rotate through billions of addresses inside its `/64`, which would otherwise reset the count every request.
- **Shared IPs:** Indian mobile carriers put many users behind one IPv4 address (CGNAT). That's why per-IP limits are deliberately loose, and the strict limits key on the phone number or account instead.

The client IP comes from Express's `req.ip`, which depends on `TRUST_PROXY` (see [section 6](#6-deploying-on-each-host)). **If `TRUST_PROXY` is wrong, every IP-based limit is wrong.**

---

## 3. Limits

### Global floor

| Setting | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_GLOBAL_LIMIT` | `300` | Requests per window, per account or IP, across **all** routes |
| `RATE_LIMIT_GLOBAL_TTL_MS` | `60000` | Window length (1 minute) |

Never limited: `/health`, `/api/v1/health`, the Razorpay webhook (its signature is checked, and blocking Razorpay's retries could lose payment confirmations), and the internal dispatch cron (it requires a secret).

### Route rules (`src/common/rate-limit/rate-limit.rules.ts`)

| Rule | Routes | Limit | Counted by |
|---|---|---|---|
| `OTP_SEND` | customer + agent `send-otp`, `resend-otp` | 20 / 15 min | IP |
| `OTP_VERIFY` | customer + agent `verify-otp` | 30 / 15 min | IP |
| `ADMIN_LOGIN` | admin `login` | 20 / 15 min | IP |
| `ADMIN_CHANGE_PASSWORD` | admin `change-password` | 5 / 15 min | account |
| `ADMIN_BROADCAST` | admin `notifications/send` | 5 / min | account |
| `BOOKING_CREATE` | customer `POST bookings`, `bookings/plan`, `bookings/beauty` (one shared count) | 10 / hour | account |
| `BOOKING_CHANGE` | customer booking `cancel`, `reschedule`, `change-cook` (shared) | 20 / hour | account |
| `PAYMENT_CREATE` | customer `payments/create` | 20 / hour | account |
| `SUPPORT_TICKET` | customer + agent `POST support` | 5 / hour | account |
| `RATING` | customer `POST ratings` | 20 / hour | account |
| `DEVICE_TOKEN` | customer + agent `notifications/device-token` | 10 / hour | account |
| `AGENT_LOCATION` | agent `POST location` | 30 / min | account |
| `AGENT_DOCUMENT` | agent `POST documents` | 20 / hour | account |
| `CITY_WAITLIST` | customer `serviceability/notify` | 10 / hour | account |
| `REFERRAL_VALIDATE` | agent `GET referrals/validate/:code` | 30 / hour | account |

After going over a limit, the client stays blocked for one window (`blockDuration` defaults to the window length).

### Per-account rules

**OTP, per phone number.** These are counted in Postgres (`otp_verifications`), so they hold across all servers even if Redis is down.

| Setting | Default | What happens |
|---|---|---|
| `OTP_MAX_ATTEMPTS` | `5` | Wrong guesses per code. Counted **atomically**: parallel guesses can't exceed it |
| `OTP_MAX_SENDS_PER_HOUR` | `5` | OTP SMS per number per hour (customer + agent combined) |
| `OTP_MAX_SENDS_PER_DAY` | `10` | OTP SMS per number per rolling 24 h |
| `OTP_MAX_FAILED_PER_HOUR` | `10` | Wrong guesses per number across all codes; then both sending and verifying are locked until the hour passes |
| `OTP_RESEND_INTERVAL_SECONDS` | `30` | Existing cooldown between sends (unchanged) |

Also in `otp.service.ts`:
- Codes come from `crypto.randomInt` (was `Math.random`).
- A code can log in **once**, even if submitted twice in parallel.
- Sends for one number run under a Postgres advisory lock, so parallel sends can't slip past the caps.

**Admin login, per email:** 10 attempts per 15 minutes, then blocked for 15 minutes (`ADMIN_LOGIN_PER_EMAIL` in `rate-limit.rules.ts`). Checked before bcrypt, so floods stay cheap. Successful logins count too; real admins don't log in 10 times in 15 minutes.

**"Notify me":** at most 10 cities per customer (`CITY_WAITLIST_MAX_CITIES`), so made-up city names can't flood the waitlist.

**Referral code check:** 30 per hour is plenty for someone typing a code on the signup form, and keeps anyone from guessing their way through the ~28M codes per year.

---

## 4. Storage: Redis or memory

| `REDIS_URL` | Behaviour |
|---|---|
| set | All server instances share one count. Use this in every deployed environment. One Redis call per request (two on routes with their own limit); the Lua script is loaded once and then called by its hash |
| not set | Counts live in each instance's memory. Fine for local dev and a single server; on serverless or multiple instances the effective limit is multiplied by the number of instances. A warning is logged at startup in staging/production |
| set, but Redis is down, hung or slow | **Circuit breaker, fails open to memory.** The first failing call gives up after 100 ms (`RATE_LIMIT_REDIS_TIMEOUT_MS`). Redis is then skipped for 30 s (`RATE_LIMIT_REDIS_BREAKER_MS`) and counts go to per-instance memory. After that, a single request probes Redis while the rest stay on memory. A reconnect switches back to Redis immediately. One log line when it opens and one when it closes |

At boot, requests wait for the first Redis connection **once**, at most 1 s, all sharing the same wait. After that nothing ever waits for a connection.

**Clustered Redis** (`REDIS_CLUSTER=true`): uses the cluster client. Each counter and its block flag share a [hash tag](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/#hash-tags) (`{...}`), so both keys live on the same node. Clustered Redis rejects a script that touches keys on different nodes (`CROSSSLOT`).

The OTP per-number limits and the city cap use Postgres and don't depend on Redis at all.

Redis keys look like `{rl:global:ip:49.36.1.2}`, `{rl:otp-send:ip:...}`, `{rl:booking-create:user:<id>}`, plus a `:block` suffix while a client is blocked. Every key has a TTL; nothing needs cleaning up.

**Is Redis in use right now?** `GET /health` includes `"rateLimit": { "store": "redis" | "memory", "degraded": true | false }`. `degraded: true` means Redis is configured but currently skipped. Alert on it: everything still works, but the limits are per instance.

---

## 5. Configuration

| Variable | Default | Notes |
|---|---|---|
| `REDIS_URL` | *(unset)* | `redis://host:6379`, or `rediss://` for TLS |
| `REDIS_CLUSTER` | `false` | `true` for clustered Redis (see section 6) |
| `RATE_LIMIT_REDIS_TIMEOUT_MS` | `100` | A Redis call slower than this counts as a failure and opens the circuit breaker |
| `RATE_LIMIT_REDIS_BREAKER_MS` | `30000` | How long Redis is skipped after a failure |
| `TRUST_PROXY` | `1` | Proxy hops in front of the app: number, `false`, or subnet list (`loopback, 10.0.0.0/8`). `true` means 1 |
| `RATE_LIMIT_ENABLED` | `true` | `false` turns off the guard (global + route rules). OTP and admin-email limits stay on |
| `RATE_LIMIT_GLOBAL_LIMIT` | `300` | |
| `RATE_LIMIT_GLOBAL_TTL_MS` | `60000` | |
| `OTP_MAX_SENDS_PER_HOUR` | `5` | |
| `OTP_MAX_SENDS_PER_DAY` | `10` | |
| `OTP_MAX_FAILED_PER_HOUR` | `10` | |

---

## 6. Deploying on each host

The code is the same everywhere; only `REDIS_URL`, `REDIS_CLUSTER` and `TRUST_PROXY` change.

| Host | `REDIS_URL` | `REDIS_CLUSTER` | `TRUST_PROXY` |
|---|---|---|---|
| **Vercel** (now) | Upstash Redis: `rediss://default:<password>@<host>:6379` | `false` | `1` |
| **AWS**, ALB → app | ElastiCache (Redis/Valkey), `rediss://` if in-transit encryption is on | `false` with cluster mode disabled (primary endpoint); `true` with cluster mode enabled (configuration endpoint) | `1` |
| **AWS**, CloudFront → ALB → app | ElastiCache | as above | `2` |
| **Azure** App Service | Azure Cache for Redis: `rediss://:<access-key>@<name>.redis.cache.windows.net:6380` | `false` unless clustering is on (Premium clustered, or the OSS cluster policy on Enterprise / Azure Managed Redis) | `1` |
| **Azure**, Front Door → App Service | Azure Cache for Redis | as above | `2`, or Front Door's subnets |

**Keep Redis in the same region as the app.** Same-region calls take about 1 ms. A Redis farther away adds that distance to every request, and if it's routinely slower than 100 ms the circuit breaker treats it as down. If you can't co-locate it, raise `RATE_LIMIT_REDIS_TIMEOUT_MS`.

**Check `TRUST_PROXY` after every migration.** Make one anonymous request, then list the Redis keys (`redis-cli --scan --pattern '{rl:global:ip:*'`). The `ip:` value must be your real public IP.
- If it shows the load balancer's address, `TRUST_PROXY` is too low, and every user shares one counter.
- If you can change it by sending your own `X-Forwarded-For` header, `TRUST_PROXY` is too high or the app is reachable without the proxy. Clients can then spoof IPs and bypass per-IP limits. **Never expose the app directly while `TRUST_PROXY` is above 0.**

**Outer layer (needed at scale):** Vercel Firewall rate rules, AWS WAF rate-based rules, or Azure Front Door WAF. The app's limiter is not DDoS protection: every request still reaches Node and Redis before it's rejected. Large floods have to be absorbed at the edge. These rules are per host; the app's own limits never depend on them.

---

## 7. What clients see

```json
HTTP/1.1 429 Too Many Requests
Retry-After: 60

{ "statusCode": 429, "message": "Too many OTP requests for this number. Try again in 45 minute(s)." }
```

- Show `message` to the user; it's written for them.
- **Don't auto-retry on 429.** Wait at least `Retry-After` seconds. Retrying immediately extends nothing but wastes requests.
- The agent app's location pings should skip a failed ping rather than retry it.
- Successful responses carry `X-RateLimit-Limit-global`, `X-RateLimit-Remaining-global` and `X-RateLimit-Reset-global` (plus `-route` variants on rate-limited routes).

---

## 8. Operations

**Logs:** blocks are counted, not logged one by one; during a flood that would be one line per request. Per bucket, the first block each minute is logged right away, then one JSON summary line a minute:
```
WARN [RateLimit] 429 bucket=otp-send key=ip:49.36.1.2 POST /api/v1/customer/auth/send-otp (further blocks this minute go in the summary)
WARN [RateLimit] 429 summary {"windowSeconds":60,"buckets":[{"bucket":"otp-send","blocked":1840,"clients":3,"top":[{"key":"ip:49.36.1.2","count":1790}, ...]}]}
```
- The summary covers the guard's buckets plus `otp-number-hourly`, `otp-number-daily`, `otp-number-lockout` and `admin-login-email`. Phone numbers and emails are masked.
- Turn the summary into metrics and alerts with your host's log tooling: CloudWatch metric filters, Azure Monitor log alerts, or Vercel log drains.
- 429 responses are **left out of the access log** (morgan) for the same reason; the summary has the counts.

The circuit breaker logs `Redis unavailable (...)` when it opens and `Redis is back` when it closes.

**Unblocking someone:**
- Guard limits: `redis-cli --scan --pattern '*rl:*<ip-or-user-id>*' | xargs redis-cli del`.
- OTP lockout for a number: mark that number's recent rows as used, e.g. `UPDATE otp_verifications SET verified_at = NOW() WHERE mobile = '98…' AND verified_at IS NULL AND created_at > NOW() - INTERVAL '1 day';`.

**Adding a limit to a new route:**
1. Add a rule to `RATE_LIMITS` in `rate-limit.rules.ts`: `{ bucket, limit, ttl, by: 'ip' | 'user' }`.
2. Put `@RateLimit(RATE_LIMITS.MY_RULE)` above the route. Routes sharing a `bucket` share a count.
3. Use `@NoRateLimit()` only for machine callers that must never be blocked (webhooks, health, cron).

**Running the tests:**
```bash
TEST_DB_USER=$(whoami) npm run test:e2e                                         # memory backend
TEST_REDIS_URL=redis://127.0.0.1:6379/15 TEST_DB_USER=$(whoami) npm run test:e2e   # + Redis tests
TEST_REDIS_CLUSTER_URL=redis://127.0.0.1:7001 ... npm run test:e2e                  # + cluster test
```
- The Redis tests flush the database index you give them, so use a spare one (`/15`).
- The stalled-Redis test uses `CLIENT PAUSE`, so point it at a Redis nobody else is using.
- A throwaway 3-node cluster: start three `redis-server --port 700X --cluster-enabled yes --cluster-config-file nodes.conf --dir <own dir>`, then `redis-cli --cluster create 127.0.0.1:7001 127.0.0.1:7002 127.0.0.1:7003 --cluster-replicas 0 --cluster-yes`.

**Local Redis:** `brew install redis && redis-server`, or `docker run -p 6379:6379 redis:7`, then `REDIS_URL=redis://127.0.0.1:6379`.

---

## 9. Performance

Measured on a laptop: bare route with no database work, 50 concurrent clients, Redis on the same machine. In production, add one network round trip per Redis call (about 1 ms in the same region).

| Setup | Requests/s | p50 | p99 |
|---|---|---|---|
| Limiter off | 8,114 | 5 ms | 11 ms |
| Limiter on, Redis | 8,319 | 5 ms | 10 ms |
| Limiter on, Redis Cluster (3 nodes) | 8,302 | 5 ms | 9 ms |

What a broken Redis costs each request:

| Redis state | Before the circuit breaker | Now |
|---|---|---|
| Hung (accepts connections, never answers) | 1–2 s on many requests, repeating on every reconnect | 1–10 ms; one shared wait of at most 1 s at boot |
| Stalls for 4 s | +0.5 s on every request (+1 s on routes with their own limit) | one request pays ~100 ms, then Redis is skipped |

Zones and upcoming cities are cached in memory for 60 s, so the serviceability check doesn't query Postgres on every call. Admin changes to zones clear the cache on that server; other servers pick them up within a minute.

---

## 10. Still open

Ordered by risk:

1. **Check OTP demo mode in production.** With `OTP_DEMO_MODE=true`, or when no SMS provider keys are set, every code is `1111` and `send-otp` returns it in the response. Anyone could log in as anyone. `.env.stg.example` turns it on.
2. **Move to 6-digit OTPs** (`OTP_LENGTH=6`, plus the input fields in both apps). With 4 digits and the caps above, a determined attacker gets at most 50 guesses per number per day (0.5% per day). With 6 digits that drops to 0.005%.
3. **Global SMS budget.** Per-IP and per-number caps don't stop an attacker with many IPs spraying many numbers. Add a circuit breaker on total OTP sends per hour with an alert, sized at roughly 5–10× normal peak.
4. **Request body limit is 10 MB on every route** (`main.ts`), including public ones. Lower the default to around 100 KB and raise it only on routes that need it, after checking which uploads send large JSON.
5. **Old OTP rows are never deleted.** The per-number queries use the `mobile` index and only look at the last 24 hours, so this is fine for a long time. Eventually add a cleanup job, and an index on `(mobile, created_at)`.
6. **Admin lockout can be triggered by others:** anyone who knows an admin's email can keep that account blocked by sending wrong passwords. That's the usual trade-off; if it becomes a problem, add 2FA and let a correct 2FA login bypass the lock.
7. **Outer WAF layer** on the final host (section 6). Required once traffic is large enough to attract real floods.
8. **Database connections**, the first real scaling limit and not part of rate limiting. On Vercel every instance holds its own Postgres connection, so N concurrent instances means N connections. Put a pooler in front of Postgres: Aiven connection pools (PgBouncer), RDS Proxy on AWS, or PgBouncer on Azure Flexible Server.
9. **Readiness endpoint returns 404.** `main.ts` excludes the path `health` from the `/api/v1` prefix, so the detailed readiness check (database status) ends up on `/health` behind the simpler liveness handler. `/api/v1/health` is a 404, although the startup log advertises it. Fix the route before AWS/Azure health probes rely on it. Until then, `/health` carries the rate-limit status.
10. **Skip Redis for clients that are already blocked.** Remember active blocks in memory, so a flooding client's requests are rejected without a Redis call.
11. **One Redis round trip instead of two** on routes with their own limit (pipeline both counters).
12. **Per-IP limits vs shared carrier IPs.** As traffic grows, more real users on Airtel/Vi share IPv4 addresses, and the per-IP OTP limit will start catching them (IPv6 users, like most of Jio, are per device). Watch the 429 summary per bucket, make route limits adjustable without a deploy, and prefer device checks (Play Integrity, App Attest) over tighter IP limits.
