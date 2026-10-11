import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking, Payment, PaymentTransaction } from 'src/database/entities';
import { CustomerPaymentsController } from './payments.controller';
import { CustomerPaymentsWebhookController } from './payments-webhook.controller';
import { CustomerPaymentsService } from './payments.service';
import { DispatchModule } from 'src/dispatch/dispatch.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Payment, PaymentTransaction]),
    DispatchModule,
  ],
  controllers: [CustomerPaymentsController, CustomerPaymentsWebhookController],
  providers: [CustomerPaymentsService],
})
export class CustomerPaymentsModule {}
