import { Module } from '@nestjs/common';
import { CustomerServiceabilityController } from './serviceability.controller';

/** ServiceabilityService comes from the global CommonModule. */
@Module({
  controllers: [CustomerServiceabilityController],
})
export class CustomerServiceabilityModule {}
