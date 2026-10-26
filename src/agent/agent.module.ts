import { Module } from '@nestjs/common';
import { AgentAuthModule } from './auth/auth.module';
import { AgentRegistrationModule } from './registration/registration.module';
import { AgentDocumentsModule } from './documents/documents.module';
import { AgentProfileModule } from './profile/profile.module';
import { AgentAvailabilityModule } from './availability/availability.module';
import { AgentBookingsModule } from './bookings/bookings.module';
import { AgentLocationModule } from './location/location.module';
import { AgentAttendanceModule } from './attendance/attendance.module';
import { AgentEarningsModule } from './earnings/earnings.module';
import { AgentRatingsModule } from './ratings/ratings.module';
import { AgentNotificationsModule } from './notifications/notifications.module';
import { AgentSupportModule } from './support/support.module';
import { AgentSkillsModule } from './skills/skills.module';
import { AgentReferralsModule } from './referrals/referrals.module';

/** Agent Mobile App — everything under /api/v1/agent/*. */
@Module({
  imports: [
    AgentAuthModule,
    AgentRegistrationModule,
    AgentDocumentsModule,
    AgentProfileModule,
    AgentAvailabilityModule,
    AgentSkillsModule,
    AgentBookingsModule,
    AgentLocationModule,
    AgentAttendanceModule,
    AgentEarningsModule,
    AgentRatingsModule,
    AgentNotificationsModule,
    AgentSupportModule,
    AgentReferralsModule,
  ],
})
export class AgentModule {}
