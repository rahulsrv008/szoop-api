import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as os from 'os';
import { from, of, Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { appVersion } from '../common/utils/version';
import { resolveAppEnv } from '../config/env';
import { RateLimitStorage, RateLimitStoreStatus } from '../common/rate-limit/rate-limit.storage';

export type HealthPayload = {
  status: 'ok' | 'degraded';
  env: string;
  timestamp: Date;
  appVersion: string;
  startedAt: Date;
  osUpTime: number;
  appUpTime: number;
  database: { dbStatus: string; dbError?: string };
  /** Informational: a degraded rate-limit store doesn't fail readiness (limits fall back to memory). */
  rateLimit: RateLimitStoreStatus;
};

@Injectable()
export class HealthService {
  started = new Date();

  constructor(
    private readonly dataSource: DataSource,
    private readonly rateLimits: RateLimitStorage,
  ) {}

  private checkDbConnection(): Observable<{
    dbStatus: string;
    dbError?: string;
  }> {
    if (!this.dataSource.isInitialized) {
      return of({
        dbStatus: 'disconnected',
        dbError: 'DataSource not initialized',
      });
    }

    return from(this.dataSource.query('SELECT 1')).pipe(
      map(() => ({ dbStatus: 'connected' })),
      catchError((error: Error) =>
        of({ dbStatus: 'disconnected', dbError: error.message }),
      ),
    );
  }

  getHealthStatus(): Observable<HealthPayload> {
    const timestamp = new Date();

    return this.checkDbConnection().pipe(
      map((dbInfo) => ({
        status: dbInfo.dbStatus === 'connected' ? 'ok' : 'degraded',
        env: resolveAppEnv(),
        timestamp,
        appVersion,
        startedAt: this.started,
        osUpTime: os.uptime(),
        appUpTime: (Date.now() - Number(this.started)) / 1000,
        database: dbInfo,
        rateLimit: this.rateLimits.status(),
      })),
    );
  }
}
