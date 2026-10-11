import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Admin,
  AdminZone,
  Agent,
  AuditLog,
  Booking,
  BookingStatusHistory,
  CityWaitlist,
  Customer,
  CustomerAddress,
  DeviceToken,
  Notification,
  OtpVerification,
  RefreshToken,
  ServiceArea,
  ServiceZoneArea,
  SystemSetting,
  UpcomingCity,
  User,
  WalletTransaction,
} from 'src/database/entities';
import { IdentityService } from './auth/identity.service';
import { TokenService } from './auth/token.service';
import { OtpService } from './auth/otp.service';
import { AuditService } from './services/audit.service';
import { NotificationDispatchService } from './services/notification-dispatch.service';
import { BookingHistoryService } from './booking/booking-history.service';
import { SettingsService } from './services/settings.service';
import { ZoneResolverService } from './services/zone-resolver.service';
import { ServiceabilityService } from './services/serviceability.service';
import { AdminAccessService } from './auth/admin-access';
import { WalletService } from './services/wallet.service';
import { BookingClosureService } from './booking/booking-closure.service';

/**
 * Cross-app building blocks (identity, tokens, OTP, audit, notifications).
 * Global so the customer/agent/admin feature modules can inject them without
 * re-importing plumbing everywhere.
 */
@Global()
@Module({
  imports: [
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
      SystemSetting,
      ServiceArea,
      ServiceZoneArea,
      UpcomingCity,
      CityWaitlist,
      WalletTransaction,
    ]),
  ],
  providers: [
    IdentityService,
    TokenService,
    OtpService,
    AuditService,
    NotificationDispatchService,
    BookingHistoryService,
    SettingsService,
    ZoneResolverService,
    ServiceabilityService,
    AdminAccessService,
    WalletService,
    BookingClosureService,
  ],
  exports: [
    IdentityService,
    TokenService,
    OtpService,
    AuditService,
    NotificationDispatchService,
    BookingHistoryService,
    SettingsService,
    ZoneResolverService,
    ServiceabilityService,
    AdminAccessService,
    WalletService,
    BookingClosureService,
  ],
})
export class CommonModule {}
