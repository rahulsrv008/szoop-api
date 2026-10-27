import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentAvailability, Booking } from 'src/database/entities';
import { AgentSharedModule } from '../shared/agent-shared.module';
import { AgentAvailabilityController } from './availability.controller';
import { AgentAvailabilityService } from './availability.service';
import { DispatchModule } from 'src/dispatch/dispatch.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentAvailability, Booking]),
    AgentSharedModule,
    DispatchModule,
  ],
  controllers: [AgentAvailabilityController],
  providers: [AgentAvailabilityService],
})
export class AgentAvailabilityModule {}
