import { Global, Module } from '@nestjs/common';
import { SmsService } from './sms/sms.service';
import { RazorpayService } from './payments/razorpay.service';
import { PushService } from './push/push.service';
import { RouteEtaService } from './maps/route-eta.service';
import { BookingEtaService } from './maps/booking-eta.service';

/** Third-party edges (SMS, payment gateway, push, maps) available app-wide. */
@Global()
@Module({
  providers: [SmsService, RazorpayService, PushService, RouteEtaService, BookingEtaService],
  exports: [SmsService, RazorpayService, PushService, RouteEtaService, BookingEtaService],
})
export class IntegrationsModule {}
