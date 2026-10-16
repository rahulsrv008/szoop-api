import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Notification } from 'src/database/entities';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { ListAgentNotificationsDto } from './dto/list-notifications.dto';
import {
  RegisterDeviceTokenDto,
  RemoveDeviceTokenDto,
} from './dto/device-token.dto';

/**
 * This app's notifications: one user can be both a customer and an agent (same
 * mobile), so each app lists only its own, plus older untagged ones.
 */
const APP = 'agent' as const;
const mine = (userId: string, extra: { isRead?: boolean } = {}) => [
  { userId, app: APP, ...extra },
  { userId, app: IsNull(), ...extra },
];

/** Notifications hang off `users.id`, so no agent lookup is needed here. */
@Injectable()
export class AgentNotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  async list(userId: string, query: ListAgentNotificationsDto) {
    const [rows, total] = await this.notificationRepo.findAndCount({
      where: mine(userId, query.unreadOnly ? { isRead: false } : {}),
      order: { createdAt: 'DESC' },
      ...skipTake(query),
    });

    const unreadCount = await this.notificationRepo.count({
      where: mine(userId, { isRead: false }),
    });

    return {
      ...paginated(
        rows.map((row) => ({
          id: row.id,
          title: row.title,
          message: row.message,
          notificationType: row.notificationType,
          isRead: row.isRead,
          createdAt: row.createdAt,
        })),
        total,
        query,
      ),
      unreadCount,
    };
  }

  async markRead(userId: string, id: string) {
    const notification = await this.notificationRepo.findOne({
      where: { id, userId },
    });
    if (!notification) throw new NotFoundException('Notification not found');

    notification.isRead = true;
    await this.notificationRepo.save(notification);
    return { id: notification.id, isRead: true };
  }

  async markAllRead(userId: string) {
    const result = await this.notificationRepo
      .createQueryBuilder()
      .update()
      .set({ isRead: true })
      .where('user_id = :userId AND is_read = false AND (app = :app OR app IS NULL)', { userId, app: APP })
      .execute();
    return { updated: result.affected ?? 0 };
  }

  registerDevice(userId: string, dto: RegisterDeviceTokenDto) {
    return this.dispatch.registerDevice(userId, dto.token, dto.platform, APP);
  }

  removeDevice(userId: string, dto: RemoveDeviceTokenDto) {
    return this.dispatch.deactivateDevice(userId, dto.token);
  }
}
