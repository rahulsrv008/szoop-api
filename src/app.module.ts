import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerModule } from './logger/logger.module';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { HealthModule } from './health/health.module';
import { CustomerModule } from './customer/customer.module';
import { AgentModule } from './agent/agent.module';
import { AdminModule } from './admin/admin.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { AdminAccessInterceptor } from './common/auth/admin-access.interceptor';

@Module({
  imports: [
    LoggerModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? ['.env.production', '.env']
          : process.env.NODE_ENV === 'staging'
            ? ['.env.stg', '.env']
            : ['.env'],
    }),
    DatabaseModule,
    IntegrationsModule,
    CommonModule,
    HealthModule,
    // One app per client: /api/v1/customer/*, /api/v1/agent/*, /api/v1/admin/*
    CustomerModule,
    AgentModule,
    AdminModule,
    DispatchModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: AdminAccessInterceptor },
  ],
})
export class AppModule {}
