import { Module } from '@nestjs/common';
import { CustomerAuthModule } from './auth/auth.module';
import { CustomerProfileModule } from './profile/profile.module';
import { CustomerAddressesModule } from './addresses/addresses.module';
import { CustomerServicesModule } from './services/services.module';
import { CustomerBookingsModule } from './bookings/bookings.module';
import { CustomerTrackingModule } from './tracking/tracking.module';
import { CustomerPaymentsModule } from './payments/payments.module';
import { CustomerRatingsModule } from './ratings/ratings.module';
import { CustomerNotificationsModule } from './notifications/notifications.module';
import { CustomerSupportModule } from './support/support.module';
import { CustomerHomeModule } from './home/home.module';
import { CustomerServiceabilityModule } from './serviceability/serviceability.module';
import { CustomerWalletModule } from './wallet/wallet.module';
import { CustomerCouponsModule } from './coupons/coupons.module';

/** Customer Mobile App — everything under /api/v1/customer/*. */
@Module({
  imports: [
    CustomerAuthModule,
    CustomerProfileModule,
    CustomerAddressesModule,
    CustomerServicesModule,
    CustomerBookingsModule,
    CustomerTrackingModule,
    CustomerPaymentsModule,
    CustomerRatingsModule,
    CustomerNotificationsModule,
    CustomerSupportModule,
    CustomerHomeModule,
    CustomerServiceabilityModule,
    CustomerWalletModule,
    CustomerCouponsModule,
  ],
})
export class CustomerModule {}
