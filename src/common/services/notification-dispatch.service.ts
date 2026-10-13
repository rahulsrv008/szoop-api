import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DeviceToken, Notification } from 'src/database/entities';
import { PushService } from 'src/integrations/push/push.service';

export interface DispatchInput {
  title: string;
  message: string;
  type?: string;
  data?: Record<string, string>;
}

/**
 * Writes the in-app notification row (what the apps read) and fans the same
 * payload out to FCM. Used by customer, agent and admin modules.
 */
@Injectable()
export class NotificationDispatchService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(DeviceToken)
    private readonly deviceTokenRepo: Repository<DeviceToken>,
    private readonly push: PushService,
  ) {}

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
        }),
      ),
    );

    const devices = await this.deviceTokenRepo.find({
      where: { userId: In(unique), isActive: true },
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

  async registerDevice(userId: string, token: string, platform?: string) {
    const existing = await this.deviceTokenRepo.findOne({ where: { token } });
    if (existing) {
      existing.userId = userId;
      existing.platform = platform ?? existing.platform;
      existing.isActive = true;
      return this.deviceTokenRepo.save(existing);
    }
    return this.deviceTokenRepo.save(
      this.deviceTokenRepo.create({
        userId,
        token,
        platform: platform ?? null,
        isActive: true,
      }),
    );
  }

  async deactivateDevice(userId: string, token: string) {
    await this.deviceTokenRepo.update({ userId, token }, { isActive: false });
    return { ok: true };
  }
}
