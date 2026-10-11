import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { attachDatabasePool } from '@vercel/functions';
import { DataSource } from 'typeorm';

type PgPool = {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  options: { max?: number };
  connect: (...args: any[]) => any;
  query: (sql: string) => Promise<{ rows: any[] }>;
  on: (event: string, listener: (...args: any[]) => void) => void;
};

type PgError = { code?: string; message?: string };

/** Postgres "too many connections": every non-superuser slot on the server is taken. */
const SLOTS_FULL = '53300';

/** After the server refuses us, wait this long before asking it who holds the slots. */
const SNAPSHOT_DELAY_MS = 20_000;

/**
 * Logs the local connection pool's life (opened / closed / refused) with live
 * counts, so a refused connection shows whether this process or another client
 * (e.g. Vercel instances on the same database) is holding the slots.
 */
@Injectable()
export class DbPoolMonitor implements OnApplicationBootstrap {
  private readonly logger = new Logger('DbPool');
  private pool: PgPool | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;

  constructor(private readonly dataSource: DataSource) {}

  onApplicationBootstrap() {
    const pool = (this.dataSource.driver as unknown as { master?: PgPool }).master;
    if (!pool) {
      this.logger.warn('No pg pool found; connection logging is off');
      return;
    }
    this.pool = pool;
    // A frozen Vercel instance can't run the pool's idle timer, so its sockets
    // would hold server slots until the instance dies. This releases them first.
    if (process.env.VERCEL) attachDatabasePool(pool as never);

    pool.on('connect', () => this.logger.log(`Connection opened — ${this.describe()}`));
    pool.on('remove', () => this.logger.log(`Connection closed — ${this.describe()}`));
    pool.on('error', (err: PgError) =>
      this.logger.error(`Idle connection error ${err.code ?? ''} ${err.message ?? ''} — ${this.describe()}`),
    );

    const connect = pool.connect.bind(pool);
    pool.connect = (callback?: (...args: any[]) => void) => {
      if (typeof callback === 'function') {
        return connect((err: PgError | undefined, ...rest: any[]) => {
          if (err) this.onRefused(err);
          callback(err, ...rest);
        });
      }
      return connect().catch((err: PgError) => {
        this.onRefused(err);
        throw err;
      });
    };

    this.logger.log(`Monitoring pool — ${this.describe()}`);
  }

  /** e.g. "pool 3/5 open, 1 idle, 0 waiting" */
  describe() {
    const pool = this.pool;
    if (!pool) return 'pool unknown';
    return `pool ${pool.totalCount}/${pool.options.max ?? '?'} open, ${pool.idleCount} idle, ${pool.waitingCount} waiting`;
  }

  private onRefused(err: PgError) {
    this.logger.error(`Connect refused ${err.code ?? ''} ${err.message ?? ''} — ${this.describe()}`);
    if (err.code === SLOTS_FULL && !this.snapshotTimer) {
      this.snapshotTimer = setTimeout(() => void this.logServerSlots(), SNAPSHOT_DELAY_MS);
      this.snapshotTimer.unref();
    }
  }

  /** Who holds the server's connection slots, grouped by client address. */
  private async logServerSlots() {
    this.snapshotTimer = null;
    if (!this.pool) return;
    try {
      const { rows } = await this.pool.query(
        `SELECT coalesce(client_addr::text, 'local') AS addr, state, count(*)::int AS n,
                max(now() - state_change)::text AS longest_idle
           FROM pg_stat_activity
          WHERE datname IS NOT NULL
          GROUP BY 1, 2
          ORDER BY n DESC`,
      );
      const max = await this.pool.query('SHOW max_connections');
      const used = rows.reduce((sum, row) => sum + row.n, 0);
      this.logger.warn(
        `Server slots: ${used}/${max.rows[0]?.max_connections} used — ` +
          rows.map((r) => `${r.addr} ${r.state ?? '-'} ×${r.n} (idle ${r.longest_idle ?? '-'})`).join('; '),
      );
    } catch (err) {
      const e = err as PgError;
      this.logger.warn(`Server slot snapshot failed ${e.code ?? ''} ${e.message ?? ''}`);
    }
  }
}
