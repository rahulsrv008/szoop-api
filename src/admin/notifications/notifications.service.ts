import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { Notification, User } from 'src/database/entities';
import { AuditService } from 'src/common/services/audit.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { SendAdminNotificationDto } from './dto/send-notification.dto';
import { ListAdminNotificationsDto } from './dto/list-notifications.dto';

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
  async send(adminId: string, dto: SendAdminNotificationDto) {
    const userIds = await this.resolveRecipients(dto);
    if (!userIds.length) {
      throw new BadRequestException('No active recipients matched');
    }

    await this.dispatch.toUsers(userIds, {
      title: dto.title,
      message: dto.message,
      type: dto.type ?? 'general',
      // Customers or agents: only that app. All or specific users: every app they use.
      app: dto.audience === 'CUSTOMERS' ? 'customer' : dto.audience === 'AGENTS' ? 'agent' : undefined,
    });

    await this.audit.record({
      userId: adminId,
      action: 'NOTIFICATION_BROADCAST',
      entityType: 'notifications',
      entityId: null,
      oldData: null,
      newData: {
        audience: dto.audience,
        recipients: userIds.length,
        title: dto.title,
        message: dto.message,
        type: dto.type ?? 'general',
      },
    });

    return { recipients: userIds.length };
  }

  async list(query: ListAdminNotificationsDto) {
    const { skip, take } = skipTake(query);

    const rowsQb = this.applyFilters(this.baseQuery(), query)
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
      this.applyFilters(this.baseQuery(), query).getCount(),
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

  private async resolveRecipients(dto: SendAdminNotificationDto) {
    if (dto.audience === 'SPECIFIC') {
      if (!dto.userIds?.length) {
        throw new BadRequestException(
          'userIds is required when audience is SPECIFIC',
        );
      }
      const users = await this.userRepo.find({
        where: { id: In(dto.userIds), isActive: true },
        select: ['id'],
      });
      return users.map((user) => user.id);
    }

    const qb = this.userRepo
      .createQueryBuilder('user')
      .select('user.id', 'id')
      .where('user.isActive = true');

    if (dto.audience === 'CUSTOMERS') {
      qb.andWhere('user.userType = :userType', { userType: 'customer' });
    }
    if (dto.audience === 'AGENTS') {
      qb.andWhere('user.userType = :userType', { userType: 'agent' });
    }
    if (dto.audience === 'ALL') {
      qb.andWhere('user.userType IN (:...userTypes)', {
        userTypes: ['customer', 'agent'],
      });
    }

    const rows = await qb.getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  private baseQuery() {
    return this.notificationRepo
      .createQueryBuilder('notification')
      .innerJoin('notification.user', 'user')
      .leftJoin('user.customer', 'customer')
      .leftJoin('user.agent', 'agent');
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
