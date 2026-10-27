import './register-src-alias';
import './config/timezone';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { json, urlencoded } from 'express';
import { cwd } from 'process';
import { AppModule } from './app.module';
import { PackageJson } from './common/dto/package';
import { SwaggerConfig } from './config/swagger.config';
import { isDeployedEnv, loadEnvFiles, validateEnv } from './config/env';
import { createWinstonLoggerOptions } from './logger/logger.config';
import { ensureLogDir, LOG_DIR } from './logger/log-paths';
import { CustomLoggerService } from 'src/common/utils/logger.service';
import { ROUTES } from './app.routes';

/** Boots Nest. On Vercel this returns the Express app and does not listen. */
export async function createServer(listen = !process.env.VERCEL) {
  const appEnv = loadEnvFiles();
  validateEnv(appEnv);

  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(createWinstonLoggerOptions()),
  });

  if (!process.env.VERCEL) ensureLogDir();
  const customLoggerService = app.get(CustomLoggerService);
  const deployed = isDeployedEnv(appEnv);

  const expressApp = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: unknown) => void;
  };
  expressApp.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      hsts: deployed
        ? { maxAge: 15552000, includeSubDomains: true }
        : false,
    }),
  );
  app.use(compression());

  const logStream = process.env.VERCEL
    ? process.stdout
    : fs.createWriteStream(path.resolve(process.cwd(), LOG_DIR, 'access.log'), {
        flags: 'a',
      });
  app.use(
    morgan(process.env.MORGAN_FORMAT || 'combined', {
      stream: logStream,
      // Rate-limited requests are counted in the per-minute "429 summary" log
      // instead; during a flood one line per request would swamp the logs.
      skip: (_req, res) => res.statusCode === 429,
    }),
  );

  app.use(
    json({
      limit: '10mb',
      verify: (req, _res, buf: Buffer) => {
        (req as IncomingMessage & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  // Vercel rewrites the real path as ?__path=. The strict query pipe treats
  // that extra field as invalid and returns 400 on routes like /admin/dashboard.
  app.use((req, _res, next) => {
    const query = req.query as Record<string, unknown> | undefined;
    if (query && Object.prototype.hasOwnProperty.call(query, '__path')) {
      delete query.__path;
    }
    next();
  });

  app.setGlobalPrefix(ROUTES.API_PREFIX, {
    exclude: [
      { path: '', method: RequestMethod.GET },
      { path: 'health', method: RequestMethod.GET },
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = Number(configService.get('PORT')) || 3000;

  const allowedOrigins = (configService.get<string>('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (
        !deployed &&
        /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(
          origin,
        )
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Api-Key',
      'x-correlation-id',
    ],
    credentials: true,
    optionsSuccessStatus: 200,
    maxAge: 86400,
  });

  const swaggerOn =
    (process.env.ENABLE_SWAGGER ?? (appEnv === 'production' ? 'false' : 'true'))
      .toLowerCase() !== 'false';

  if (swaggerOn) {
    const packageJson: PackageJson = JSON.parse(
      fs.readFileSync(path.join(cwd(), 'package.json'), 'utf-8'),
    ) as PackageJson;
    const publicUrl =
      process.env.APP_URL || process.env.STG_API_URL || `http://localhost:${port}`;

    const config = new DocumentBuilder()
      .setTitle('ClearIt API')
      .setDescription(
        [
          packageJson.description || 'ClearIt backend',
          '',
          `Environment: **${appEnv}**`,
          '',
          'Surfaces under `/api/v1`:',
          '- **customer** — Customer Mobile (OTP auth)',
          '- **agent** — Agent Mobile (OTP auth + job lifecycle)',
          '- **admin** — Admin Web (email/password)',
        ].join('\n'),
      )
      .setVersion(packageJson.version)
      .addServer(publicUrl, appEnv)
      .addServer(`http://localhost:${port}`, 'Local')
      .addTag('health', 'Liveness / readiness')
      .addTag('customer', 'Customer Mobile App')
      .addTag('agent', 'Agent Mobile App')
      .addTag('admin', 'Admin Web')
      .addBearerAuth(SwaggerConfig, 'access-token')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    const swaggerOpts = {
      persistAuthorization: true,
      docExpansion: 'list' as const,
      filter: true,
      tagsSorter: 'alpha' as const,
      operationsSorter: 'alpha' as const,
      displayRequestDuration: true,
    };
    SwaggerModule.setup(ROUTES.SWAGGER, app, document, {
      customSiteTitle: 'ClearIt API · Swagger',
      swaggerOptions: swaggerOpts,
      jsonDocumentUrl: `${ROUTES.SWAGGER}-json`,
    });
    SwaggerModule.setup('docs', app, document, {
      customSiteTitle: 'ClearIt API · Swagger',
      swaggerOptions: swaggerOpts,
    });
  }

  if (!listen) {
    await app.init();
    return app.getHttpAdapter().getInstance();
  }

  try {
    await app.listen(port, '0.0.0.0');
    customLoggerService.log(
      `clearit-be (${appEnv}) listening on ${await app.getUrl()} db=${process.env.DB_HOST}`,
      'bootstrap',
    );
    customLoggerService.log(
      `health=/health  ready=/${ROUTES.API_PREFIX}/${ROUTES.HEALTH}`,
      'bootstrap',
    );
  } catch (err) {
    customLoggerService.error(
      'Failed to start',
      err instanceof Error ? err.stack : undefined,
      'bootstrap',
    );
    process.exit(1);
  }
}

/**
 * How many proxy hops sit in front of the app, so req.ip is the real client
 * (rate limits key on it). Number of hops (default 1), 'false', or a list of
 * trusted subnets such as 'loopback, 10.0.0.0/8'. See docs/rate-limiting.md.
 */
function trustProxySetting(raw?: string): boolean | number | string {
  const value = (raw ?? '').trim();
  if (!value) return 1;
  if (value === 'false') return false;
  // 'true' has always meant one hop here; trusting every hop would let clients spoof X-Forwarded-For.
  if (value === 'true') return 1;
  return /^\d+$/.test(value) ? Number(value) : value;
}

if (!process.env.VERCEL) {
  void createServer(true);
}

/** Vercel rewrite sends the real path as ?__path= so Nest still sees /health and /api/v1/... */
function restoreVercelUrl(req: IncomingMessage) {
  const raw = req.url || '/';
  const qIndex = raw.indexOf('?');
  if (qIndex === -1) return;
  const params = new URLSearchParams(raw.slice(qIndex + 1));
  const nested = params.get('__path');
  if (!nested) return;
  params.delete('__path');
  const qs = params.toString();
  req.url = qs ? `${nested}?${qs}` : nested;
}

let vercelServer: Promise<(req: IncomingMessage, res: ServerResponse) => unknown> | null = null;

/** Default export so Vercel can use src/main.js or dist/main.js as the function entry. */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  restoreVercelUrl(req);
  if (!vercelServer) {
    vercelServer = createServer(false) as Promise<(req: IncomingMessage, res: ServerResponse) => unknown>;
  }
  const server = await vercelServer;
  return server(req, res);
}
