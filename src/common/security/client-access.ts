import type { NextFunction, Request, Response } from 'express';
import type { CustomLoggerService } from 'src/common/utils/logger.service';

export type ClientAccessMode = 'off' | 'report' | 'enforce';

const PRIVATE_NETWORK_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/;

/** Browser origins allowed to call the API: ALLOWED_ORIGINS, plus the local network outside deployed envs. */
export function originAllowed(origin: string, allowedOrigins: string[], deployed: boolean) {
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return true;
  return !deployed && PRIVATE_NETWORK_ORIGIN.test(origin);
}

export function readClientAccessMode(raw: string | undefined, deployed: boolean): ClientAccessMode {
  const mode = (raw ?? '').trim().toLowerCase();
  if (mode === 'off' || mode === 'report' || mode === 'enforce') return mode;
  return deployed ? 'report' : 'off';
}

interface ClientAccessOptions {
  mode: ClientAccessMode;
  appKeys: string[];
  allowedOrigins: string[];
  deployed: boolean;
  openPaths: RegExp;
  logger: CustomLoggerService;
}

/**
 * Only the Szoop/Aira mobile apps (X-App-Key) and allowed browser origins may
 * call the API. App keys ship inside the app and Origin can be forged outside a
 * browser, so this stops casual and scripted direct calls, not a determined
 * attacker; login, roles and rate limits still do the real protecting.
 */
export function clientAccess(options: ClientAccessOptions) {
  const keys = new Set(options.appKeys.filter(Boolean));
  let windowStart = Date.now();
  let blockedInWindow = 0;

  const note = (req: Request) => {
    if (Date.now() - windowStart > 60_000) {
      if (blockedInWindow > 5) {
        options.logger.warn(`client-access: ${blockedInWindow} requests without an app key or allowed origin in the last minute`, 'ClientAccess');
      }
      windowStart = Date.now();
      blockedInWindow = 0;
    }
    blockedInWindow += 1;
    if (blockedInWindow <= 5) {
      options.logger.warn(
        `client-access ${options.mode}: ${req.method} ${req.path} ip=${req.ip} origin=${req.get('origin') ?? '-'} ua=${(req.get('user-agent') ?? '-').slice(0, 80)}`,
        'ClientAccess',
      );
    }
  };

  return (req: Request, res: Response, next: NextFunction) => {
    if (options.mode === 'off' || req.method === 'OPTIONS' || options.openPaths.test(req.path)) return next();

    const key = req.get('x-app-key');
    if (key && keys.has(key)) return next();

    const origin = req.get('origin');
    if (origin && originAllowed(origin, options.allowedOrigins, options.deployed)) return next();

    note(req);
    if (options.mode === 'report') return next();
    res.status(403).json({ statusCode: 403, error: 'Forbidden', message: 'This API only accepts requests from Szoop apps.' });
  };
}
