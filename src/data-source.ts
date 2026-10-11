import './config/timezone';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';
import 'dotenv/config';

const env = process.env;

const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.DB_HOST,
  port: parseInt(env.DB_PORT || '5432', 10),
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  synchronize: false,
  logging: env.DB_LOGGING === 'true',
  entities: [path.join(__dirname, 'database/entities/*.{ts,js}')],
  schema: env.DB_SCHEMA || 'public',
  ssl:
    (env.DB_SSL ?? 'true').toLowerCase() !== 'false'
      ? { rejectUnauthorized: false }
      : false,
});

const initializeConnection = async () => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
};

export { AppDataSource, initializeConnection };
