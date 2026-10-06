# CleanIt API (`clearit-be`)

NestJS backend for CleanIt — same layout style as `f2o-cops-disruption-portal-be-module` (Mars):

- `src/apis/*` feature modules
- `src/db/entities` TypeORM entities
- `src/config` TypeORM + Swagger
- `src/logger` Winston daily rotate logs
- `.env` keys (you fill values)

Aligned to **CleanIt architecture / STG roadmap**: Auth OTP, Users, Addresses, Bookings state machine, Razorpay payments, GPS tracking, `/health`.

PostgreSQL schema is the full 32-table design (customers, agents, services, bookings, payments, earnings, coupons, support, etc.). Run `sql/001_full_schema.sql` in pgAdmin on the `clearit` database. Keep `DB_SYNC=false`.


## Staging

STG is meant to run compiled JS against the Aiven (or other hosted) Postgres, with schema applied from `sql/001_full_schema.sql` — **not** TypeORM `synchronize`.

```bash
cp .env.stg.example .env.stg
# fill DB_*, JWT_SECRET (>= 24 chars), ALLOWED_ORIGINS, APP_URL
npm install
npm run build
NODE_ENV=staging npm run start:stg
```

Or Docker:

```bash
docker build -t clearit-be:stg .
docker run --env-file .env.stg -p 3000:3000 clearit-be:stg
```

| Check | URL |
|---|---|
| Liveness (load balancer) | `GET /health` |
| Readiness (DB) | `GET /api/v1/health` — **503** if Postgres is down |
| Swagger (STG only) | `/api` and `/docs` (`ENABLE_SWAGGER=false` in production) |

Staging boot **fails fast** if `DB_*` or `JWT_SECRET` is missing, if `JWT_SECRET` is a local default, if `ALLOWED_ORIGINS` is empty, or if `DB_SYNC=true`.

CORS in staging/production only allows origins listed in `ALLOWED_ORIGINS` (mobile apps with no `Origin` header still pass). Apply the SQL schema in pgAdmin before the first boot.

Seed an admin after the schema exists:

```bash
NODE_ENV=staging npm run seed:admin -- you@clearit.in 'A-strong-password'
```

## Quick start


```bash
cd /Users/rahulsrivastav/Desktop/clearIt/clearit-be
cp .env.example .env   # if needed
# fill DB_* , JWT_SECRET, and vendor keys in .env
npm install
npm run start:dev
```

- API: `http://localhost:3000` (or `PORT` from `.env`)
- Swagger UI: `http://localhost:3000/api` (also `/docs`)
- OpenAPI JSON: `http://localhost:3000/api-json`
- Health: `http://localhost:3000/health` (liveness) and `http://localhost:3000/api/v1/health` (DB ready)
- Postman: import `postman/ClearIt-API.postman_collection.json` (regenerate with `npm run postman:generate`)

## `.env` keys you must fill

| Key | Purpose |
|-----|---------|
| `PORT` | API port (default 3000) |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | Postgres |
| `DB_SCHEMA` | `public` (default Postgres schema) |
| `DB_SSL` | `true`/`false` |
| `DB_SYNC` | keep `false` (use SQL / migrations for schema) |
| `JWT_SECRET` | session signing |
| `ALLOWED_ORIGINS` | CORS (comma-separated) |
| `SMS_*` / `OTP_*` | OTP sandbox (`OTP_DEMO_MODE=true` accepts demo OTP) |
| `RAZORPAY_*` | test keys for STG |
| `MAPS_API_KEY` / `FCM_*` | maps + push (later weeks) |

## Booking flow (shared record)

`finding → paid → accepted → arriving → ongoing → completed` (+ `cancelled` before start)

## Main routes

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | STG checklist |
| POST | `/auth/request-otp` | SMS / demo OTP |
| POST | `/auth/verify-otp` | JWT |
| GET/PATCH | `/users/me` | profile |
| CRUD | `/addresses` | customer addresses |
| POST/GET | `/bookings` | create + list |
| PATCH | `/bookings/:id/accept\|arriving\|start\|complete\|cancel\|rate` | state machine |
| POST | `/payments/create-order/:bookingId` | Razorpay stub/order |
| POST | `/payments/confirm/:bookingId` | mark paid (STG helper) |
| POST | `/payments/webhook` | Razorpay webhook |
| POST | `/tracking/ping` | agent GPS |
| GET | `/tracking/latest/:bookingId` | customer map |

## Notes

- **Rate limiting:** see [docs/rate-limiting.md](docs/rate-limiting.md). Set `REDIS_URL` and `TRUST_PROXY` in every deployed environment.

- Schema SQL: `sql/001_full_schema.sql` (32 tables). Existing STG APIs still work against the new tables.
- Keep `DB_SYNC=false` and create/update tables via that SQL in pgAdmin.

## End-to-end tests

`test/e2e/` boots the real app against a throwaway Postgres and walks the booking flow: creation, payment, push dispatch, the agent's job list, accept, the job lifecycle, releases, no-shows and admin actions. Each file rebuilds the schema, so the database name **must end in `_test`** (the harness refuses otherwise).

```bash
createdb clearit_test            # once, on a local Postgres
npm run test:e2e                 # TEST_DB_HOST/PORT/USER/PASSWORD/NAME override the defaults (127.0.0.1:5432, postgres, clearit_test)
```

The suite runs under `TZ=UTC` on purpose, to prove booking times are still read as India time. Tests marked `todo` describe known open bugs; they're reported but don't fail the run.
