import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

const WINDOW_MS = 60_000;
/** Distinct clients remembered per bucket per minute, so an IP-spraying flood can't grow memory. */
const MAX_KEYS_PER_BUCKET = 1000;

type Bucket = { blocked: number; byKey: Map<string, number> };

/**
 * Counts 429s instead of logging each one: under attack that would be one log
 * line per request. Logs the first block per bucket each minute right away,
 * then one summary line per minute with counts and the top offenders. The
 * summary is JSON, so hosts can turn it into metrics and alerts
 * (CloudWatch metric filters, Azure Monitor log alerts, Vercel log drains).
 */
@Injectable()
export class RateLimitStats implements OnModuleDestroy {
  private readonly logger = new Logger('RateLimit');
  private buckets = new Map<string, Bucket>();
  private windowStart = Date.now();
  private readonly timer = setInterval(() => this.flush(), WINDOW_MS);

  constructor() {
    this.timer.unref?.();
  }

  record(bucket: string, key: string, context = '') {
    // Serverless instances may be frozen between requests, so also roll the window lazily.
    if (Date.now() - this.windowStart >= WINDOW_MS) this.flush();
    let entry = this.buckets.get(bucket);
    if (!entry) {
      entry = { blocked: 0, byKey: new Map() };
      this.buckets.set(bucket, entry);
      this.logger.warn(`429 bucket=${bucket} key=${key}${context ? ` ${context}` : ''} (further blocks this minute go in the summary)`);
    }
    entry.blocked += 1;
    if (entry.byKey.has(key) || entry.byKey.size < MAX_KEYS_PER_BUCKET) {
      entry.byKey.set(key, (entry.byKey.get(key) ?? 0) + 1);
    }
  }

  /** Blocks per bucket so far in the current window (for tests and diagnostics). */
  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.buckets].map(([name, b]) => [name, b.blocked]));
  }

  flush() {
    if (this.buckets.size) {
      const summary = [...this.buckets].map(([bucket, b]) => ({
        bucket,
        blocked: b.blocked,
        clients: b.byKey.size,
        top: [...b.byKey]
          .sort((x, y) => y[1] - x[1])
          .slice(0, 3)
          .map(([key, count]) => ({ key, count })),
      }));
      const seconds = Math.round((Date.now() - this.windowStart) / 1000);
      this.logger.warn(`429 summary ${JSON.stringify({ windowSeconds: seconds, buckets: summary })}`);
    }
    this.buckets = new Map();
    this.windowStart = Date.now();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    this.flush();
  }
}

/** "9876543210" -> "98******10": enough to spot a pattern without logging the number. */
export function maskMobile(mobile: string) {
  return mobile.length > 4 ? `${mobile.slice(0, 2)}${'*'.repeat(mobile.length - 4)}${mobile.slice(-2)}` : '****';
}

/** "ops.lead@clearit.in" -> "op***@clearit.in". */
export function maskEmail(email: string) {
  const [user, domain = ''] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}
