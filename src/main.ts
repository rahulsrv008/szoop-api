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
import { IncomingMessage } from 'http';
import { json, urlencoded } from 'express';
import { cwd } from 'process';
import { AppModule } from './app.module';
import { PackageJson } from './common/dto/package';
import { SwaggerConfig } from './config/swagger.config';
import { isDeployedEnv, loadEnvFiles, validateEnv } from './config/env';
import { createWinstonLoggerOptions } from './logger/logger.config';
import { ensureLogDir, LOG_DIR } from './logger/log-paths';
import { CustomLoggerService } from './common/utils/logger.service';
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

  const expressApp = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: unknown) => void;
  };
  expressApp.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());

  const logStream = process.env.VERCEL
    ? process.stdout
    : fs.createWriteStream(path.resolve(process.cwd(), LOG_DIR, 'access.log'), {
        flags: 'a',
      });
  app.use(
    morgan(process.env.MORGAN_FORMAT || 'combined', { stream: logStream }),
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
  const deployed = isDeployedEnv(appEnv);

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
      `clearit-be (${appEnv}) listening on ${await app.getUrl()}`,
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

if (!process.env.VERCEL) {
  void createServer(true);
}
