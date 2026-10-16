import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { SupportTicket } from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { AuditService } from 'src/common/services/audit.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { ListAdminSupportDto } from './dto/list-support.dto';
import { UpdateAdminSupportTicketDto } from './dto/update-support.dto';

interface TicketListRow {
  id: string;
  subject: string | null;
  priority: string;
  status: string;
  userId: string;
  userType: string;
  mobile: string;
  customerFirstName: string | null;
  customerLastName: string | null;
  agentFirstName: string | null;
  agentLastName: string | null;
  bookingId: string | null;
  bookingNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AdminSupportService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationDispatchService,
    private readonly access: AdminAccessService,
  ) {}

  async list(query: ListAdminSupportDto) {
    const { skip, take } = skipTake(query);

    const rowsQb = this.applyFilters(this.baseQuery(), query)
      .select('ticket.id', 'id')
      .addSelect('ticket.subject', 'subject')
      .addSelect('ticket.priority', 'priority')
      .addSelect('ticket.status', 'status')
      .addSelect('ticket.userId', 'userId')
      .addSelect('user.userType', 'userType')
      .addSelect('user.mobile', 'mobile')
      .addSelect('customer.firstName', 'customerFirstName')
      .addSelect('customer.lastName', 'customerLastName')
      .addSelect('agent.firstName', 'agentFirstName')
      .addSelect('agent.lastName', 'agentLastName')
      .addSelect('ticket.bookingId', 'bookingId')
      .addSelect('booking.bookingNumber', 'bookingNumber')
      .addSelect('ticket.createdAt', 'createdAt')
      .addSelect('ticket.updatedAt', 'updatedAt')
      .orderBy('ticket.createdAt', 'DESC')
      .offset(skip)
      .limit(take);

    const [rows, total] = await Promise.all([
      rowsQb.getRawMany<TicketListRow>(),
      this.applyFilters(this.baseQuery(), query).getCount(),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        subject: row.subject,
        priority: row.priority,
        status: row.status,
        raisedBy: {
          userId: row.userId,
          userType: row.userType,
          name:
            this.fullName(row.customerFirstName, row.customerLastName) ??
            this.fullName(row.agentFirstName, row.agentLastName),
          mobile: row.mobile,
        },
        bookingId: row.bookingId,
        bookingNumber: row.bookingNumber,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      total,
      query,
    );
  }

  async detail(id: string) {
    const ticket = await this.requireTicket(id, [
      'user',
      'user.customer',
      'user.agent',
      'booking',
    ]);

    return {
      id: ticket.id,
      subject: ticket.subject,
      description: ticket.description,
      priority: ticket.priority,
      status: ticket.status,
      raisedBy: {
        userId: ticket.userId,
        userType: ticket.user?.userType ?? null,
        mobile: ticket.user?.mobile ?? null,
        email: ticket.user?.email ?? null,
        isActive: ticket.user?.isActive ?? null,
        customerId: ticket.user?.customer?.id ?? null,
        agentId: ticket.user?.agent?.id ?? null,
        name:
          this.fullName(
            ticket.user?.customer?.firstName ?? null,
            ticket.user?.customer?.lastName ?? null,
          ) ??
          this.fullName(
            ticket.user?.agent?.firstName ?? null,
            ticket.user?.agent?.lastName ?? null,
          ),
      },
      booking: ticket.booking
        ? {
            id: ticket.booking.id,
            bookingNumber: ticket.booking.bookingNumber,
            bookingDate: ticket.booking.bookingDate,
            startTime: ticket.booking.startTime,
            status: ticket.booking.status,
            paymentStatus: ticket.booking.paymentStatus,
            totalAmount: Number(ticket.booking.totalAmount),
          }
        : null,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
  }

  /**
   * `support_tickets` has no reply/notes column, so a resolutionNote is
   * delivered to the raiser as a notification and kept in the audit log.
   */
  async update(adminId: string, id: string, dto: UpdateAdminSupportTicketDto) {
    const ticket = await this.requireTicket(id);
    const oldData = { status: ticket.status, priority: ticket.priority };

    if (dto.status !== undefined) ticket.status = dto.status;
    if (dto.priority !== undefined) ticket.priority = dto.priority;
    await this.ticketRepo.save(ticket);

    let noteDelivered = false;
    if (dto.resolutionNote) {
      await this.notifications.toUser(ticket.userId, {
        // Back to the app the ticket came from (both, for older tickets).
        app: ticket.app ?? undefined,
        title: `Update on your ticket${ticket.subject ? `: ${ticket.subject}` : ''}`,
        message: dto.resolutionNote,
        type: 'support',
      });
      noteDelivered = true;
    }

    await this.audit.record({
      userId: adminId,
      action: 'SUPPORT_TICKET_UPDATED',
      entityType: 'support_tickets',
      entityId: ticket.id,
      oldData,
      newData: {
        status: ticket.status,
        priority: ticket.priority,
        resolutionNote: dto.resolutionNote ?? null,
      },
    });

    return {
      id: ticket.id,
      status: ticket.status,
      priority: ticket.priority,
      resolutionNoteSentToRaiser: noteDelivered,
      message: noteDelivered
        ? 'Ticket updated and the resolution note was sent to the raiser as a notification.'
        : 'Ticket updated.',
    };
  }

  private baseQuery() {
    return this.ticketRepo
      .createQueryBuilder('ticket')
      .innerJoin('ticket.user', 'user')
      .leftJoin('user.customer', 'customer')
      .leftJoin('user.agent', 'agent')
      .leftJoin('ticket.booking', 'booking');
  }

  private applyFilters(
    qb: SelectQueryBuilder<SupportTicket>,
    query: ListAdminSupportDto,
  ) {
    if (query.search) {
      qb.andWhere('ticket.subject ILIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }
    if (query.status) {
      qb.andWhere('ticket.status = :status', { status: query.status });
    }
    if (query.priority) {
      qb.andWhere('ticket.priority = :priority', { priority: query.priority });
    }
    if (query.from) {
      qb.andWhere('ticket.createdAt >= :from', {
        from: new Date(`${query.from}T00:00:00.000Z`),
      });
    }
    if (query.to) {
      qb.andWhere('ticket.createdAt <= :to', {
        to: new Date(`${query.to}T23:59:59.999Z`),
      });
    }
    this.access.restrictSupport(qb);
    return qb;
  }

  private async requireTicket(id: string, relations: string[] = []) {
    const ticket = await this.ticketRepo.findOne({
      where: { id },
      relations: [
        ...new Set([
          ...relations,
          'booking',
          'user',
          'user.customer',
          'user.agent',
        ]),
      ],
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    this.access.assertSupport({
      bookingZoneId: ticket.booking?.serviceAreaId,
      customerZoneId: ticket.user?.customer?.homeZoneId,
      agentHomeZoneId: ticket.user?.agent?.homeZoneId,
      agentServiceAreas: ticket.user?.agent?.serviceAreas,
    });
    return ticket;
  }

  private fullName(firstName: string | null, lastName: string | null) {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  }
}
