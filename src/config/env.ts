import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';

export type AppEnv = 'development' | 'uat' | 'production' | 'test';

const FILE_FOR: Record<Exclude<AppEnv, 'test'>, string> = {
  development: '.env.development',
  uat: '.env.uat',
  production: '.env.production',
};

export function resolveAppEnv(): AppEnv {
  const raw = (process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();
  if (raw === 'dev') return 'development';
  if (raw === 'stg' || raw === 'stage' || raw === 'staging' || raw === 'uat') return 'uat';
  if (raw === 'prod' || raw === 'production') return 'production';
  if (raw === 'test' || raw === 'development' || raw === 'uat') return raw;
  return 'development';
}

export function isDeployedEnv(env: AppEnv = resolveAppEnv()): boolean {
  return env === 'uat' || env === 'production';
}

/** Load `.env` then overlay `.env.development` / `.env.uat` / `.env.production`. Platform env vars still win if already set, except overlays override the base file. */
export function loadEnvFiles(): AppEnv {
  if (existsSync('.env')) {
    loadEnv({ path: '.env' });
  }
  const requested = resolveAppEnv();
  if (requested !== 'test') {
    const overlay = FILE_FOR[requested];
    const aliases = requested === 'uat' ? [overlay, '.env.stg'] : [overlay];
    for (const file of aliases) {
      if (existsSync(file)) {
        loadEnv({ path: file, override: true });
        break;
      }
    }
  }
  const appEnv = resolveAppEnv();
  process.env.APP_ENV = appEnv;
  process.env.NODE_ENV =
    appEnv === 'development' ? 'development' : appEnv === 'test' ? 'test' : 'production';
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
      `Missing required env: ${missing.join(', ')}. Copy .env.${appEnv === 'uat' ? 'uat' : appEnv}.example and fill values.`,
    );
  }

  if (!isDeployedEnv(appEnv)) return;

  const jwt = process.env.JWT_SECRET?.trim() ?? '';
  if (WEAK_JWT.includes(jwt) || jwt.length < 24) {
    throw new Error(
      'JWT_SECRET is too weak for uat/production. Set a long random secret.',
    );
  }

  const origins = process.env.ALLOWED_ORIGINS?.trim();
  if (!origins) {
    throw new Error(
      'ALLOWED_ORIGINS is required in uat/production (comma-separated frontend URLs).',
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
    throw new Error('DB_SYNC must be false in uat/production. Apply sql/001_full_schema.sql instead.');
  }
}
