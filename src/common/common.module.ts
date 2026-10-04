import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Admin,
  AdminZone,
  Agent,
  AuditLog,
  Booking,
  BookingStatusHistory,
  Customer,
  CustomerAddress,
  DeviceToken,
  Notification,
  OtpVerification,
  RefreshToken,
  ServiceArea,
  ServiceZoneArea,
  SystemSetting,
  User,
} from 'src/database/entities';
import { IdentityService } from './auth/identity.service';
import { TokenService } from './auth/token.service';
import { OtpService } from './auth/otp.service';
import { AuditService } from './services/audit.service';
import { NotificationDispatchService } from './services/notification-dispatch.service';
import { BookingHistoryService } from './booking/booking-history.service';
import { SettingsService } from './services/settings.service';
import { ZoneResolverService } from './services/zone-resolver.service';
import { AdminAccessService } from './auth/admin-access';

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
    AdminAccessService,
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
    AdminAccessService,
  ],
})
export class CommonModule {}
