import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  Agent,
  AgentLocation,
  Booking,
  Payment,
  PaymentStatus,
} from 'src/database/entities';
import { ACTIVE_STATUSES, ASSIGNABLE } from 'src/common/booking/booking-status';
import { BookingHistoryService } from 'src/common/booking/booking-history.service';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { AuditService } from 'src/common/services/audit.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { DispatchService } from 'src/dispatch/dispatch.service';
import { ListAdminBookingsDto } from './dto/list-bookings.dto';
import { AssignAdminBookingAgentDto } from './dto/assign-agent.dto';
import { ReassignAdminBookingAgentDto } from './dto/reassign-agent.dto';
import { CancelAdminBookingDto } from './dto/cancel-booking.dto';

interface BookingListRow {
  id: string;
  bookingNumber: string;
  customerId: string;
  customerFirstName: string | null;
  customerLastName: string | null;
  customerMobile: string;
  agentId: string | null;
  agentFirstName: string | null;
  agentLastName: string | null;
  bookingDate: string;
  startTime: string;
  status: string;
  paymentStatus: string;
  totalAmount: string;
  planTitle: string | null;
}

/** Statuses that still occupy an agent's calendar slot. */
const CLASH_STATUSES = ACTIVE_STATUSES;

function addMinutesToTime(time: string, minutes: number) {
  const [hours, mins, seconds] = time.split(':').map((part) => Number(part));
  const total = hours * 60 + mins + minutes;
  // Jobs are same-day, so a window that would spill past midnight is clamped.
  if (total >= 24 * 60) return '23:59:59';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}:${pad(
    seconds || 0,
  )}`;
}

@Injectable()
export class AdminBookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(AgentLocation)
    private readonly locationRepo: Repository<AgentLocation>,
    private readonly history: BookingHistoryService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationDispatchService,
    private readonly access: AdminAccessService,
    private readonly dispatch: DispatchService,
  ) {}

  async list(query: ListAdminBookingsDto) {
    const { skip, take } = skipTake(query);

    const rowsQb = this.applyFilters(
      this.bookingRepo
        .createQueryBuilder('booking')
        .innerJoin('booking.customer', 'customer')
        .innerJoin('customer.user', 'customerUser')
        .leftJoin('booking.agent', 'agent'),
      query,
    )
      .select('booking.id', 'id')
      .addSelect('booking.bookingNumber', 'bookingNumber')
      .addSelect('booking.customerId', 'customerId')
      .addSelect('customer.firstName', 'customerFirstName')
      .addSelect('customer.lastName', 'customerLastName')
      .addSelect('customerUser.mobile', 'customerMobile')
      .addSelect('booking.agentId', 'agentId')
      .addSelect('agent.firstName', 'agentFirstName')
      .addSelect('agent.lastName', 'agentLastName')
      .addSelect(`to_char(booking.bookingDate, 'YYYY-MM-DD')`, 'bookingDate')
      .addSelect('booking.startTime', 'startTime')
      .addSelect('booking.status', 'status')
      .addSelect('booking.paymentStatus', 'paymentStatus')
      .addSelect('booking.totalAmount', 'totalAmount')
      .addSelect('booking.planTitle', 'planTitle')
      .orderBy('booking.bookingDate', 'DESC')
      .addOrderBy('booking.startTime', 'DESC')
      .offset(skip)
      .limit(take);

    const countQb = this.applyFilters(
      this.bookingRepo
        .createQueryBuilder('booking')
        .innerJoin('booking.customer', 'customer')
        .innerJoin('customer.user', 'customerUser')
        .leftJoin('booking.agent', 'agent'),
      query,
    );

    const [rows, total] = await Promise.all([
      rowsQb.getRawMany<BookingListRow>(),
      countQb.getCount(),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        bookingNumber: row.bookingNumber,
        customerId: row.customerId,
        customerName: this.fullName(
          row.customerFirstName,
          row.customerLastName,
        ),
        customerMobile: row.customerMobile,
        agentId: row.agentId,
        agentName: this.fullName(row.agentFirstName, row.agentLastName),
        bookingDate: row.bookingDate,
        startTime: row.startTime,
        status: row.status,
        paymentStatus: row.paymentStatus,
        totalAmount: Number(row.totalAmount),
        planTitle: row.planTitle,
      })),
      total,
      query,
    );
  }

  async detail(id: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id },
      relations: [
        'items',
        'items.service',
        'address',
        'serviceArea',
        'payment',
        'payment.transactions',
        'agent',
        'agent.user',
        'customer',
        'customer.user',
        'statusHistory',
        'ratings',
        'ratings.reviews',
      ],
    });
    if (!booking) throw new NotFoundException('Booking not found');
    this.access.assertZone(booking.serviceAreaId, 'Booking');

    const trackingPings = await this.locationRepo.count({
      where: { bookingId: id },
    });

    return {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      durationMinutes: booking.durationMinutes,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      notes: booking.notes,
      planType: booking.planType,
      planTitle: booking.planTitle,
      amounts: {
        subtotal: Number(booking.subtotal),
        discount: Number(booking.discount),
        tax: Number(booking.tax),
        totalAmount: Number(booking.totalAmount),
      },
      customer: booking.customer
        ? {
            customerId: booking.customer.id,
            userId: booking.customer.userId,
            name: this.fullName(
              booking.customer.firstName,
              booking.customer.lastName,
            ),
            mobile: booking.customer.user?.mobile ?? null,
            email: booking.customer.user?.email ?? null,
          }
        : null,
      agent: booking.agent
        ? {
            agentId: booking.agent.id,
            userId: booking.agent.userId,
            name: this.fullName(
              booking.agent.firstName,
              booking.agent.lastName,
            ),
            mobile: booking.agent.user?.mobile ?? null,
            status: booking.agent.status,
            approvalStatus: booking.agent.approvalStatus,
          }
        : null,
      address: booking.address,
      serviceArea: booking.serviceArea
        ? { id: booking.serviceArea.id, name: booking.serviceArea.name }
        : null,
      items: (booking.items ?? []).map((item) => ({
        id: item.id,
        serviceId: item.serviceId,
        serviceName: item.service?.name ?? null,
        quantity: item.quantity,
        durationMinutes: item.durationMinutes,
        pricePerHour:
          item.pricePerHour === null ? null : Number(item.pricePerHour),
        amount: item.amount === null ? null : Number(item.amount),
      })),
      payment: booking.payment
        ? {
            id: booking.payment.id,
            amount: Number(booking.payment.amount),
            paymentMethod: booking.payment.paymentMethod,
            paymentStatus: booking.payment.paymentStatus,
            paidAt: booking.payment.paidAt,
            transactions: (booking.payment.transactions ?? []).map((txn) => ({
              id: txn.id,
              gatewayName: txn.gatewayName,
              gatewayTransactionId: txn.gatewayTransactionId,
              status: txn.status,
              createdAt: txn.createdAt,
            })),
          }
        : null,
      statusHistory: (booking.statusHistory ?? [])
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ratings: (booking.ratings ?? []).map((rating) => ({
        id: rating.id,
        rating: Number(rating.rating),
        createdAt: rating.createdAt,
        reviews: (rating.reviews ?? []).map((review) => ({
          id: review.id,
          reviewText: review.reviewText,
          createdAt: review.createdAt,
        })),
      })),
      trackingPings,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    };
  }

  async assignAgent(
    adminId: string,
    id: string,
    dto: AssignAdminBookingAgentDto,
  ) {
    const booking = await this.requireBooking(id);

    if (!ASSIGNABLE.includes(booking.status)) {
      throw new BadRequestException(
        booking.status === 'finding'
          ? 'Wait for the customer to pay before assigning an agent'
          : `An agent cannot be assigned while the booking is ${booking.status}`,
      );
    }
    if (booking.agentId) {
      throw new BadRequestException(
        'Booking already has an agent — use reassign-agent instead',
      );
    }

    const agent = await this.requireAssignableAgent(dto.agentId);
    await this.assertNoClash(booking, agent.id);

    const oldData = { agentId: booking.agentId, status: booking.status };

    booking.agentId = agent.id;
    await this.history.transition(
      booking,
      'accepted',
      adminId,
      dto.remarks ?? 'Agent assigned by admin',
    );
    // Withdraw any offers still out, so nobody else accepts into a 409.
    await this.dispatch.onAccepted(booking.id, agent.id);

    await this.notifications.toUsers([agent.userId, booking.customer.userId], {
      title: 'Agent assigned',
      message: `Booking ${booking.bookingNumber} on ${booking.bookingDate} at ${booking.startTime} is now assigned to ${this.fullName(agent.firstName, agent.lastName) ?? 'an agent'}.`,
      type: 'booking',
    });

    await this.audit.record({
      userId: adminId,
      action: 'BOOKING_AGENT_ASSIGNED',
      entityType: 'bookings',
      entityId: booking.id,
      oldData,
      newData: {
        agentId: booking.agentId,
        status: booking.status,
        remarks: dto.remarks ?? null,
      },
    });

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      agentId: booking.agentId,
      status: booking.status,
      message: 'Agent assigned.',
    };
  }

  async reassignAgent(
    adminId: string,
    id: string,
    dto: ReassignAdminBookingAgentDto,
  ) {
    const booking = await this.requireBooking(id);

    if (['ongoing', 'completed', 'cancelled'].includes(booking.status)) {
      throw new BadRequestException(
        `A ${booking.status} booking cannot be reassigned`,
      );
    }
    if (!booking.agentId) {
      throw new BadRequestException(
        'Booking has no agent yet — use assign-agent instead',
      );
    }
    if (booking.agentId === dto.agentId) {
      throw new BadRequestException('That agent is already on this booking');
    }

    const previousAgent = await this.agentRepo.findOne({
      where: { id: booking.agentId },
      select: ['id', 'userId', 'firstName', 'lastName'],
    });
    const agent = await this.requireAssignableAgent(dto.agentId);
    await this.assertNoClash(booking, agent.id);

    const oldData = { agentId: booking.agentId, status: booking.status };

    booking.agentId = agent.id;
    await this.bookingRepo.save(booking);
    await this.history.record(
      booking.id,
      booking.status,
      adminId,
      `Reassigned to a new agent: ${dto.reason}`,
    );

    if (previousAgent) {
      await this.notifications.toUser(previousAgent.userId, {
        title: 'Booking reassigned',
        message: `Booking ${booking.bookingNumber} has been moved to another agent. Reason: ${dto.reason}`,
        type: 'booking',
      });
    }
    await this.notifications.toUsers([agent.userId, booking.customer.userId], {
      title: 'Agent changed',
      message: `Booking ${booking.bookingNumber} on ${booking.bookingDate} at ${booking.startTime} is now assigned to ${this.fullName(agent.firstName, agent.lastName) ?? 'a new agent'}.`,
      type: 'booking',
    });

    await this.audit.record({
      userId: adminId,
      action: 'BOOKING_AGENT_REASSIGNED',
      entityType: 'bookings',
      entityId: booking.id,
      oldData,
      newData: {
        agentId: booking.agentId,
        status: booking.status,
        reason: dto.reason,
      },
    });

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      previousAgentId: oldData.agentId,
      agentId: booking.agentId,
      status: booking.status,
      message: 'Agent reassigned.',
    };
  }

  async cancel(adminId: string, id: string, dto: CancelAdminBookingDto) {
    const booking = await this.requireBooking(id);
    const payment = await this.paymentRepo.findOne({
      where: { bookingId: booking.id },
    });

    const oldData = {
      status: booking.status,
      paymentStatus: booking.paymentStatus,
    };

    // A collected payment has to be refunded; anything unpaid is just voided.
    const nextPaymentStatus: PaymentStatus =
      payment?.paymentStatus === 'PAID' || booking.paymentStatus === 'PAID'
        ? 'REFUNDED'
        : 'VOIDED';

    booking.paymentStatus = nextPaymentStatus;
    await this.history.transition(booking, 'cancelled', adminId, dto.reason);

    if (payment) {
      payment.paymentStatus = nextPaymentStatus;
      await this.paymentRepo.save(payment);
    }

    const recipients = [booking.customer.userId];
    if (booking.agentId) {
      const agent = await this.agentRepo.findOne({
        where: { id: booking.agentId },
        select: ['id', 'userId'],
      });
      if (agent) recipients.push(agent.userId);
    }
    await this.notifications.toUsers(recipients, {
      title: 'Booking cancelled',
      message: `Booking ${booking.bookingNumber} has been cancelled. Reason: ${dto.reason}`,
      type: 'booking',
    });

    await this.audit.record({
      userId: adminId,
      action: 'BOOKING_CANCELLED',
      entityType: 'bookings',
      entityId: booking.id,
      oldData,
      newData: {
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        reason: dto.reason,
      },
    });

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      message:
        nextPaymentStatus === 'REFUNDED'
          ? 'Booking cancelled and the payment marked for refund.'
          : 'Booking cancelled and the pending payment voided.',
    };
  }

  /** The agent must be approved, not suspended, and free for the slot. */
  private async requireAssignableAgent(agentId: string) {
    const agent = await this.agentRepo.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('Agent is not approved yet');
    }
    if (agent.status === 'SUSPENDED') {
      throw new BadRequestException('Agent is suspended');
    }
    return agent;
  }

  private async assertNoClash(booking: Booking, agentId: string) {
    const windowEnd = addMinutesToTime(
      booking.startTime,
      booking.durationMinutes || 60,
    );

    const clash = await this.bookingRepo
      .createQueryBuilder('booking')
      .where('booking.agentId = :agentId', { agentId })
      .andWhere('booking.id != :bookingId', { bookingId: booking.id })
      .andWhere('booking.bookingDate = :bookingDate', {
        bookingDate: booking.bookingDate,
      })
      .andWhere('booking.status IN (:...statuses)', {
        statuses: CLASH_STATUSES,
      })
      .andWhere('booking.startTime < :windowEnd', { windowEnd })
      .andWhere(
        `(booking.startTime + (COALESCE(booking.durationMinutes, 60) * interval '1 minute')) > :windowStart`,
        { windowStart: booking.startTime },
      )
      .getOne();

    if (clash) {
      throw new BadRequestException(
        `Agent already has booking ${clash.bookingNumber} between ${clash.startTime} and ${addMinutesToTime(clash.startTime, clash.durationMinutes || 60)} that day`,
      );
    }
  }

  private applyFilters(
    qb: SelectQueryBuilder<Booking>,
    query: ListAdminBookingsDto,
  ) {
    if (query.search) {
      qb.andWhere('booking.bookingNumber ILIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }
    if (query.status) {
      qb.andWhere('booking.status = :status', { status: query.status });
    }
    if (query.paymentStatus) {
      qb.andWhere('booking.paymentStatus = :paymentStatus', {
        paymentStatus: query.paymentStatus,
      });
    }
    if (query.customerId) {
      qb.andWhere('booking.customerId = :customerId', {
        customerId: query.customerId,
      });
    }
    if (query.agentId) {
      qb.andWhere('booking.agentId = :agentId', { agentId: query.agentId });
    }
    if (query.from) {
      qb.andWhere('booking.bookingDate >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('booking.bookingDate <= :to', { to: query.to });
    }
    this.access.restrictZoneColumn(qb, 'booking.service_area_id');
    return qb;
  }

  private async requireBooking(id: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id },
      relations: ['customer'],
    });
    if (!booking) throw new NotFoundException('Booking not found');
    this.access.assertZone(booking.serviceAreaId, 'Booking');
    return booking;
  }

  private fullName(firstName: string | null, lastName: string | null) {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  }
}
