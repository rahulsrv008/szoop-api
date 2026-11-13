import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Notification, User } from 'src/database/entities';
import { AuditService } from 'src/common/services/audit.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { SendAdminNotificationDto } from './dto/send-notification.dto';
import { ListAdminNotificationsDto } from './dto/list-notifications.dto';
import type { ClientAppCode } from 'src/common/types/client-app';

interface NotificationListRow {
  id: string;
  userId: string;
  userType: string;
  mobile: string;
  customerFirstName: string | null;
  customerLastName: string | null;
  agentFirstName: string | null;
  agentLastName: string | null;
  title: string | null;
  message: string | null;
  notificationType: string | null;
  isRead: boolean;
  createdAt: Date;
}

@Injectable()
export class AdminNotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dispatch: NotificationDispatchService,
    private readonly audit: AuditService,
  ) {}

  /** Blocked users are never notified, whatever the audience. */
  async send(
    adminId: string,
    dto: SendAdminNotificationDto,
    appCode: ClientAppCode = 'SZOOP',
  ) {
    const recipients = await this.resolveRecipients(dto, appCode);
    const recipientCount =
      recipients.customerIds.length + recipients.agentIds.length;
    if (!recipientCount) {
      throw new BadRequestException('No active recipients matched');
    }

    await Promise.all([
      ...(recipients.customerIds.length
        ? [
            this.dispatch.toUsers(recipients.customerIds, {
              title: dto.title,
              message: dto.message,
              type: dto.type ?? 'general',
              app: 'customer',
            }),
          ]
        : []),
      ...(recipients.agentIds.length
        ? [
            this.dispatch.toUsers(recipients.agentIds, {
              title: dto.title,
              message: dto.message,
              type: dto.type ?? 'general',
              app: 'agent',
            }),
          ]
        : []),
    ]);

    await this.audit.record({
      userId: adminId,
      action: 'NOTIFICATION_BROADCAST',
      entityType: 'notifications',
      entityId: null,
      oldData: null,
      newData: {
        audience: dto.audience,
        appCode,
        recipients: recipientCount,
        title: dto.title,
        message: dto.message,
        type: dto.type ?? 'general',
      },
    });

    return { recipients: recipientCount };
  }

  async list(
    query: ListAdminNotificationsDto,
    appCode: ClientAppCode = 'SZOOP',
  ) {
    const { skip, take } = skipTake(query);

    const rowsQb = this.applyFilters(this.baseQuery(appCode), query)
      .select('notification.id', 'id')
      .addSelect('notification.userId', 'userId')
      .addSelect('user.userType', 'userType')
      .addSelect('user.mobile', 'mobile')
      .addSelect('customer.firstName', 'customerFirstName')
      .addSelect('customer.lastName', 'customerLastName')
      .addSelect('agent.firstName', 'agentFirstName')
      .addSelect('agent.lastName', 'agentLastName')
      .addSelect('notification.title', 'title')
      .addSelect('notification.message', 'message')
      .addSelect('notification.notificationType', 'notificationType')
      .addSelect('notification.isRead', 'isRead')
      .addSelect('notification.createdAt', 'createdAt')
      .orderBy('notification.createdAt', 'DESC')
      .offset(skip)
      .limit(take);

    const [rows, total] = await Promise.all([
      rowsQb.getRawMany<NotificationListRow>(),
      this.applyFilters(this.baseQuery(appCode), query).getCount(),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        recipient: {
          userType: row.userType,
          mobile: row.mobile,
          name:
            this.fullName(row.customerFirstName, row.customerLastName) ??
            this.fullName(row.agentFirstName, row.agentLastName),
        },
        title: row.title,
        message: row.message,
        type: row.notificationType,
        isRead: row.isRead,
        createdAt: row.createdAt,
      })),
      total,
      query,
    );
  }

  private async resolveRecipients(
    dto: SendAdminNotificationDto,
    appCode: ClientAppCode,
  ) {
    const qb = this.userRepo
      .createQueryBuilder('user')
      .select('user.id', 'id')
      .addSelect('user.userType', 'userType')
      .where('user.isActive = true');

    if (dto.audience === 'SPECIFIC') {
      if (!dto.userIds?.length) {
        throw new BadRequestException(
          'userIds is required when audience is SPECIFIC',
        );
      }
      qb.andWhere('user.id IN (:...userIds)', { userIds: dto.userIds });
    }
    if (dto.audience === 'CUSTOMERS') {
      qb.andWhere('user.userType = :userType', { userType: 'customer' });
      qb.andWhere('user.appCode = :appCode', { appCode });
    }
    if (dto.audience === 'AGENTS') {
      qb.andWhere('user.userType = :userType', { userType: 'agent' });
    }
    if (dto.audience === 'ALL') {
      qb.andWhere(
        "(user.userType = 'agent' OR (user.userType = 'customer' AND user.appCode = :appCode))",
        { appCode },
      );
    }
    if (dto.audience === 'SPECIFIC') {
      qb.andWhere(
        "(user.userType = 'agent' OR (user.userType = 'customer' AND user.appCode = :appCode))",
        { appCode },
      );
    }

    const rows = await qb.getRawMany<{ id: string; userType: string }>();
    return {
      customerIds: rows
        .filter((row) => row.userType === 'customer')
        .map((row) => row.id),
      agentIds: rows
        .filter((row) => row.userType === 'agent')
        .map((row) => row.id),
    };
  }

  private baseQuery(appCode: ClientAppCode) {
    return this.notificationRepo
      .createQueryBuilder('notification')
      .innerJoin('notification.user', 'user')
      .leftJoin('user.customer', 'customer')
      .leftJoin('user.agent', 'agent')
      .andWhere(
        "(user.userType = 'agent' OR (user.userType = 'customer' AND user.appCode = :appCode))",
        { appCode },
      );
  }

  private applyFilters(
    qb: SelectQueryBuilder<Notification>,
    query: ListAdminNotificationsDto,
  ) {
    if (query.search) {
      qb.andWhere(
        '(notification.title ILIKE :search OR notification.message ILIKE :search)',
        { search: `%${query.search.trim()}%` },
      );
    }
    if (query.type) {
      qb.andWhere('notification.notificationType = :type', {
        type: query.type,
      });
    }
    if (query.userId) {
      qb.andWhere('notification.userId = :userId', { userId: query.userId });
    }
    if (query.from) {
      qb.andWhere('notification.createdAt >= :from', {
        from: new Date(`${query.from}T00:00:00.000Z`),
      });
    }
    if (query.to) {
      qb.andWhere('notification.createdAt <= :to', {
        to: new Date(`${query.to}T23:59:59.999Z`),
      });
    }
    return qb;
  }

  private fullName(firstName: string | null, lastName: string | null) {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  }
}
