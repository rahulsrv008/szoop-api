import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { DeviceToken, Notification, NotificationApp } from 'src/database/entities';
import { PushService } from 'src/integrations/push/push.service';

export interface DispatchInput {
  title: string;
  message: string;
  type?: string;
  data?: Record<string, string>;
  /**
   * The app it's for. One user can be both a customer and an agent (same
   * mobile), so this keeps agent pushes out of the customer app and back.
   * Omitted: every app the user is signed in to (e.g. an admin broadcast to all).
   */
  app?: NotificationApp;
}

/**
 * The `app` columns (sql/notification_app.sql). Checked first so the ALTERs,
 * which lock their tables, only run when a column is actually missing.
 */
const NOTIFICATION_APP_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                 AND table_name = 'device_tokens' AND column_name = 'app') THEN
    ALTER TABLE device_tokens ADD COLUMN app VARCHAR(20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                 AND table_name = 'notifications' AND column_name = 'app') THEN
    ALTER TABLE notifications ADD COLUMN app VARCHAR(20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                 AND table_name = 'support_tickets' AND column_name = 'app') THEN
    ALTER TABLE support_tickets ADD COLUMN app VARCHAR(20);
  END IF;
END $$;
`;

/**
 * Writes the in-app notification row (what the apps read) and fans the same
 * payload out to FCM. Used by customer, agent and admin modules.
 */
@Injectable()
export class NotificationDispatchService implements OnModuleInit {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(DeviceToken)
    private readonly deviceTokenRepo: Repository<DeviceToken>,
    private readonly push: PushService,
  ) {}

  async onModuleInit() {
    try {
      await this.notificationRepo.query(NOTIFICATION_APP_SQL);
    } catch (err) {
      this.logger.error('Failed to ensure the notification app columns', err as Error);
    }
  }

  async toUser(userId: string, input: DispatchInput) {
    const [notification] = await this.toUsers([userId], input);
    return notification;
  }

  async toUsers(userIds: string[], input: DispatchInput) {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return [];

    const notifications = await this.notificationRepo.save(
      unique.map((userId) =>
        this.notificationRepo.create({
          userId,
          title: input.title,
          message: input.message,
          notificationType: input.type ?? 'general',
          isRead: false,
          app: input.app ?? null,
        }),
      ),
    );

    // Only that app's phones; untagged phones (registered before tagging) still
    // get it until their app registers again, which it does on every launch.
    const devices = await this.deviceTokenRepo.find({
      where: input.app
        ? [
            { userId: In(unique), isActive: true, app: input.app },
            { userId: In(unique), isActive: true, app: IsNull() },
          ]
        : { userId: In(unique), isActive: true },
      select: ['token'],
    });
    // A job offer rings with the agent app's ringtone on its own channel, so it
    // is heard with the app closed; the type lets the app tell offers apart.
    const ringing = input.type === 'job_offer';
    await this.push.sendToTokens(
      devices.map((device) => device.token),
      {
        title: input.title,
        body: input.message,
        data: { ...(input.data ?? {}), ...(input.type ? { type: input.type } : {}) },
        ...(ringing ? { channelId: 'job-offers', sound: 'job_ring.wav' } : {}),
      },
    );

    return notifications;
  }

  /** `app`: which app registered the phone, so pushes go only to the app they're for. */
  async registerDevice(userId: string, token: string, platform: string | undefined, app: NotificationApp) {
    const existing = await this.deviceTokenRepo.findOne({ where: { token } });
    if (existing) {
      existing.userId = userId;
      existing.platform = platform ?? existing.platform;
      existing.app = app;
      existing.isActive = true;
      return this.deviceTokenRepo.save(existing);
    }
    return this.deviceTokenRepo.save(
      this.deviceTokenRepo.create({
        userId,
        token,
        platform: platform ?? null,
        app,
        isActive: true,
      }),
    );
  }

  async deactivateDevice(userId: string, token: string) {
    await this.deviceTokenRepo.update({ userId, token }, { isActive: false });
    return { ok: true };
  }
}
