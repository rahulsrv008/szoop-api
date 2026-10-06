import { Injectable } from '@nestjs/common';
import { appVersion } from './common/utils/version';
import { resolveAppEnv } from './config/env';
import { RateLimitStorage } from './common/rate-limit/rate-limit.storage';

@Injectable()
export class AppService {
  constructor(private readonly rateLimits: RateLimitStorage) {}

  getHello() {
    return {
      service: 'clearit-be',
      env: resolveAppEnv(),
      version: appVersion,
      docs: '/api',
      health: '/health',
      ready: '/api/v1/health',
    };
  }

  getLiveness() {
    return {
      status: 'ok',
      service: 'clearit-be',
      env: resolveAppEnv(),
      version: appVersion,
      // In memory, no I/O: whether rate limits are shared via Redis right now.
      rateLimit: this.rateLimits.status(),
    };
  }
}
