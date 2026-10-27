import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Admin,
  AdminZone,
  Agent,
  AgentReferral,
  AgentReferralReward,
  AuditLog,
  Booking,
  BookingStatusHistory,
  CityWaitlist,
  Customer,
  CustomerAddress,
  DeviceToken,
  Notification,
  OtpVerification,
  Payment,
  RefreshToken,
  ServiceArea,
  ServiceZoneArea,
  SystemSetting,
  UpcomingCity,
  User,
  WalletTransaction,
} from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';
import { TokenService } from 'src/common/auth/token.service';
import { OtpService } from 'src/common/auth/otp.service';
import { AuditService } from 'src/common/services/audit.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { BookingHistoryService } from 'src/common/booking/booking-history.service';
import { BookingExpiryService } from 'src/common/booking/booking-expiry.service';
import { SettingsService } from 'src/common/services/settings.service';
import { ZoneResolverService } from 'src/common/services/zone-resolver.service';
import { ServiceabilityService } from 'src/common/services/serviceability.service';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { WalletService } from 'src/common/services/wallet.service';
import { ReferralService } from 'src/common/referrals/referral.service';
import { ReferralRewardsService } from 'src/common/referrals/referral-rewards.service';
import { BookingClosureService } from 'src/common/booking/booking-closure.service';
import { IntegrationsModule } from 'src/integrations/integrations.module';
import { RateLimitStats } from 'src/common/rate-limit/rate-limit.stats';

/**
 * Cross-app building blocks (identity, tokens, OTP, audit, notifications).
 * Global so the customer/agent/admin feature modules can inject them without
 * re-importing plumbing everywhere.
 */
@Global()
@Module({
  imports: [
    IntegrationsModule,
    TypeOrmModule.forFeature([
      User,
      Customer,
      CustomerAddress,
      Agent,
      Admin,
      AdminZone,
      OtpVerification,
      RefreshToken,
      Notification,
      DeviceToken,
      AuditLog,
      Booking,
      BookingStatusHistory,
      Payment,
      SystemSetting,
      ServiceArea,
      ServiceZoneArea,
      UpcomingCity,
      CityWaitlist,
      WalletTransaction,
      AgentReferral,
      AgentReferralReward,
    ]),
  ],
  providers: [
    IdentityService,
    TokenService,
    OtpService,
    AuditService,
    NotificationDispatchService,
    BookingHistoryService,
    BookingExpiryService,
    SettingsService,
    ZoneResolverService,
    ServiceabilityService,
    AdminAccessService,
    WalletService,
    ReferralService,
    ReferralRewardsService,
    BookingClosureService,
    RateLimitStats,
  ],
  exports: [
    IdentityService,
    TokenService,
    OtpService,
    AuditService,
    NotificationDispatchService,
    BookingHistoryService,
    BookingExpiryService,
    SettingsService,
    ZoneResolverService,
    ServiceabilityService,
    AdminAccessService,
    WalletService,
    ReferralService,
    ReferralRewardsService,
    BookingClosureService,
    RateLimitStats,
  ],
})
export class CommonModule {}
