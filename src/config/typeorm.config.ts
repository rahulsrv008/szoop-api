import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as path from 'path';

export const typeOrmConfig = (): TypeOrmModuleOptions => {
  // Vercel runs many concurrent requests in one instance; a single connection
  // queues them all behind the slowest. Keep it small: instances multiply it.
  const poolMax = process.env.VERCEL
    ? parseInt(process.env.DB_POOL_MAX_SERVERLESS ?? '2', 10)
    : parseInt(process.env.DB_POOL_MAX ?? '5', 10);
  const useSsl = (process.env.DB_SSL ?? 'true').toLowerCase() !== 'false';

  return {
    type: (process.env.DB_TYPE as 'postgres') || 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    schema: process.env.DB_SCHEMA || 'public',
    autoLoadEntities: true,
    entities: [path.join(__dirname, '../database/entities/*.{ts,js}')],
    ssl: useSsl
      ? {
          rejectUnauthorized: false,
        }
      : false,
    synchronize: false,
    poolSize: poolMax,
    extra: {
      max: poolMax,
      min: 0,
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_MS ?? '10000', 10),
      connectionTimeoutMillis: parseInt(
        process.env.DB_POOL_CONN_TIMEOUT_MS ?? '10000',
        10,
      ),
      allowExitOnIdle: true,
    },
  };
};
