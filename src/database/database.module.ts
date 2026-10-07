import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmConfig } from 'src/config/typeorm.config';
import { DbPoolMonitor } from './db-pool-monitor.service';

/** Owns the Postgres connection; tables are created via the files in `sql/`. */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: typeOrmConfig,
      inject: [ConfigService],
    }),
  ],
  providers: [DbPoolMonitor],
  exports: [DbPoolMonitor],
})
export class DatabaseModule {}
