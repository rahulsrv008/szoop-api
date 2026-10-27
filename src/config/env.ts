import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';

export type AppEnv = 'development' | 'staging' | 'production' | 'test';

export function resolveAppEnv(): AppEnv {
  const raw = (process.env.NODE_ENV || 'development').toLowerCase();
  if (raw === 'stg' || raw === 'stage') return 'staging';
  if (raw === 'prod') return 'production';
  if (raw === 'staging' || raw === 'production' || raw === 'test') return raw;
  return 'development';
}

export function isDeployedEnv(env: AppEnv = resolveAppEnv()): boolean {
  return env === 'staging' || env === 'production';
}

/** Load `.env` then overlay `.env.stg` / `.env.production` when present. Platform env vars still win if already set. */
export function loadEnvFiles(): AppEnv {
  const appEnv = resolveAppEnv();
  if (existsSync('.env')) {
    loadEnv({ path: '.env' });
  }
  const overlay =
    appEnv === 'staging'
      ? '.env.stg'
      : appEnv === 'production'
        ? '.env.production'
        : '';
  if (overlay && existsSync(overlay)) {
    loadEnv({ path: overlay, override: true });
  }
  process.env.NODE_ENV = appEnv;
  return appEnv;
}

const WEAK_JWT = [
  '',
  'change-me',
  'change-me-in-production',
  'clearit-dev-jwt-secret-change-me',
  'secret',
  'jwt-secret',
];

export function validateEnv(appEnv: AppEnv = resolveAppEnv()): void {
  const missing: string[] = [];
  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET']) {
    if (!process.env[key]?.trim()) missing.push(key);
  }
  if (missing.length) {
    throw new Error(
      `Missing required env: ${missing.join(', ')}. Copy .env.stg.example to .env.stg or set them in the host.`,
    );
  }

  if (!isDeployedEnv(appEnv)) return;

  const jwt = process.env.JWT_SECRET?.trim() ?? '';
  if (WEAK_JWT.includes(jwt) || jwt.length < 24) {
    throw new Error(
      'JWT_SECRET is too weak for staging/production. Set a long random secret.',
    );
  }

  const origins = process.env.ALLOWED_ORIGINS?.trim();
  if (!origins) {
    throw new Error(
      'ALLOWED_ORIGINS is required in staging/production (comma-separated frontend URLs).',
    );
  }

  const missingPayments = [
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
  ].filter((key) => !process.env[key]?.trim());
  if (missingPayments.length) {
    throw new Error(
      `Missing required payment env: ${missingPayments.join(', ')}. Configure Razorpay test or live credentials.`,
    );
  }

  if ((process.env.DB_SYNC ?? '').toLowerCase() === 'true') {
    throw new Error('DB_SYNC must be false in staging/production. Apply sql/001_full_schema.sql instead.');
  }
}
