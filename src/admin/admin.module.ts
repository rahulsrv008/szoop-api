import { Module } from '@nestjs/common';
import { AdminAuthModule } from './auth/auth.module';
import { AdminAdminsModule } from './admins/admins.module';
import { AdminDashboardModule } from './dashboard/dashboard.module';
import { AdminCustomersModule } from './customers/customers.module';
import { AdminAgentsModule } from './agents/agents.module';
import { AdminAttendanceModule } from './attendance/attendance.module';
import { AdminMissedJobsModule } from './missed-jobs/missed-jobs.module';
import { AdminServicesModule } from './services/services.module';
import { AdminPricingModule } from './pricing/pricing.module';
import { AdminBookingsModule } from './bookings/bookings.module';
import { AdminBookingMonitorModule } from './booking-monitor/booking-monitor.module';
import { AdminPaymentsModule } from './payments/payments.module';
import { AdminEarningsModule } from './earnings/earnings.module';
import { AdminCouponsModule } from './coupons/coupons.module';
import { AdminServiceAreasModule } from './service-areas/service-areas.module';
import { AdminSocietiesModule } from './societies/societies.module';
import { AdminRatingsModule } from './ratings/ratings.module';
import { AdminSupportModule } from './support/support.module';
import { AdminReportsModule } from './reports/reports.module';
import { AdminNotificationsModule } from './notifications/notifications.module';
import { AdminSettingsModule } from './settings/settings.module';
import { AdminCouponRulesModule } from './coupon-rules/coupon-rules.module';
import { AdminHomeContentModule } from './home-content/home-content.module';

/** Admin Web (Angular) — everything under /api/v1/admin/*. */
@Module({
  imports: [
    AdminAuthModule,
    AdminAdminsModule,
    AdminDashboardModule,
    AdminCustomersModule,
    AdminAgentsModule,
    AdminAttendanceModule,
    AdminMissedJobsModule,
    AdminServicesModule,
    AdminPricingModule,
    AdminBookingsModule,
    AdminBookingMonitorModule,
    AdminPaymentsModule,
    AdminEarningsModule,
    AdminCouponsModule,
    AdminServiceAreasModule,
    AdminSocietiesModule,
    AdminRatingsModule,
    AdminSupportModule,
    AdminReportsModule,
    AdminNotificationsModule,
    AdminSettingsModule,
    AdminCouponRulesModule,
    AdminHomeContentModule,
  ],
})
export class AdminModule {}
