import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Admin,
  Agent,
  AgentAttendance,
  AgentAvailability,
  AgentDocument,
  Booking,
  Customer,
  Payment,
  Rating,
  ServiceArea,
  SupportTicket,
} from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { ACTIVE_STATUSES } from 'src/common/booking/booking-status';
import { AdminDashboardQueryDto } from './dto/dashboard-query.dto';
import { todayString } from 'src/agent/shared/date.util';

/** Priorities the dashboard counts as "needs attention now". */
const HIGH_PRIORITIES = ['HIGH', 'URGENT'];
const LIVE_LOCATION_MAX_AGE_MS = 5 * 60 * 1000;

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class AdminDashboardService {
  constructor(
    @InjectRepository(Admin) private readonly adminRepo: Repository<Admin>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(AgentDocument)
    private readonly documentRepo: Repository<AgentDocument>,
    @InjectRepository(AgentAttendance)
    private readonly attendanceRepo: Repository<AgentAttendance>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(ServiceArea)
    private readonly serviceAreaRepo: Repository<ServiceArea>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Rating) private readonly ratingRepo: Repository<Rating>,
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    private readonly access: AdminAccessService,
  ) {}

  async overview(query: AdminDashboardQueryDto) {
    const range = this.resolveRange(query);

    const [customers, agents, bookings, revenue, ratings, support, kyc, team] =
      await Promise.all([
        this.customerStats(range),
        this.agentStats(range),
        this.bookingStats(range),
        this.revenueStats(range),
        this.ratingStats(),
        this.supportStats(),
        this.kycStats(),
        this.teamEarnings(range),
      ]);

    return {
      range: { from: range.from, to: range.to },
      customers,
      agents,
      bookings,
      revenue,
      ratings,
      support,
      kyc,
      team,
    };
  }

  async liveMap() {
    const access = this.access.current();
    const zonesQb = this.serviceAreaRepo
      .createQueryBuilder('area')
      .select('area.id', 'id')
      .addSelect('area.name', 'name')
      .addSelect('area.city', 'city')
      .addSelect('area.latitude', 'latitude')
      .addSelect('area.longitude', 'longitude')
      .addSelect('area.serviceRadiusKm', 'serviceRadiusKm')
      .where('area.isActive = true')
      .orderBy('area.name', 'ASC');

    if (!access.unrestricted) {
      if (!access.zoneIds.length) {
        return { zones: [], customers: [], agents: [], generatedAt: new Date() };
      }
      zonesQb.andWhere('area.id IN (:...zoneIds)', {
        zoneIds: access.zoneIds,
      });
    }

    const zones = await zonesQb.getRawMany<{
      id: string;
      name: string;
      city: string | null;
      latitude: number | null;
      longitude: number | null;
      serviceRadiusKm: number;
    }>();
    const customersQb = this.bookingRepo
      .createQueryBuilder('booking')
      .innerJoin('booking.customer', 'customer')
      .innerJoin('customer.user', 'customerUser')
      .innerJoin('booking.address', 'address')
      .select('booking.id', 'bookingId')
      .addSelect('customer.id', 'id')
      .addSelect('booking.serviceAreaId', 'zoneId')
      .addSelect('customer.firstName', 'firstName')
      .addSelect('customer.lastName', 'lastName')
      .addSelect('booking.status', 'status')
      .addSelect('address.latitude', 'latitude')
      .addSelect('address.longitude', 'longitude')
      .where('booking.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
      .andWhere('customerUser.isActive = true')
      .andWhere('address.latitude IS NOT NULL')
      .andWhere('address.longitude IS NOT NULL');
    this.access.restrictZoneColumn(customersQb, 'booking.service_area_id');

    const agentsQb = this.agentRepo
      .createQueryBuilder('agent')
      .innerJoin('agent.user', 'agentUser')
      .innerJoin(
        AgentAvailability,
        'availability',
        'availability.agent_id = agent.id AND availability.availability_date = :today AND availability.is_available = true',
        { today: todayString() },
      )
      .select('agent.id', 'id')
      .addSelect('agent.firstName', 'firstName')
      .addSelect('agent.lastName', 'lastName')
      .addSelect('agent.homeZoneId', 'homeZoneId')
      .addSelect('agent.serviceAreas', 'serviceAreas')
      .addSelect('agent.currentLocation', 'currentLocation')
      .where('agent.status = :status', { status: 'ACTIVE' })
      .andWhere('agent.approvalStatus = :approvalStatus', {
        approvalStatus: 'APPROVED',
      })
      .andWhere('agentUser.isActive = true')
      .andWhere('agent.currentLocation IS NOT NULL')
      .andWhere("(agent.current_location->>'recordedAt') IS NOT NULL")
      .andWhere("(agent.current_location->>'recordedAt')::timestamptz >= :since", {
        since: new Date(Date.now() - LIVE_LOCATION_MAX_AGE_MS),
      })
      .orderBy('agent.firstName', 'ASC')
      .addOrderBy('agent.lastName', 'ASC');
    this.access.restrictAgent(agentsQb, 'agent');

    const [customerRows, agentRows] = await Promise.all([
      customersQb.getRawMany<{
        bookingId: string;
        id: string;
        zoneId: string | null;
        firstName: string | null;
        lastName: string | null;
        status: string;
        latitude: string;
        longitude: string;
      }>(),
      agentsQb.getRawMany<{
        id: string;
        firstName: string | null;
        lastName: string | null;
        homeZoneId: string | null;
        serviceAreas: string[];
        currentLocation: Agent['currentLocation'];
      }>(),
    ]);

    const fullName = (firstName: string | null, lastName: string | null) =>
      [firstName, lastName].filter(Boolean).join(' ').trim() || 'Unknown';

    return {
      zones: zones.map((zone) => ({
        ...zone,
        latitude: zone.latitude === null ? null : Number(zone.latitude),
        longitude: zone.longitude === null ? null : Number(zone.longitude),
        serviceRadiusKm: Number(zone.serviceRadiusKm),
      })),
      customers: customerRows.map((row) => ({
        id: row.id,
        bookingId: row.bookingId,
        zoneId: row.zoneId,
        name: fullName(row.firstName, row.lastName),
        status: row.status,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
      })),
      agents: agentRows.map((row) => ({
        id: row.id,
        name: fullName(row.firstName, row.lastName),
        zoneIds: [
          ...new Set(
            [row.homeZoneId, ...(row.serviceAreas ?? [])].filter(
              (zoneId): zoneId is string => !!zoneId,
            ),
          ),
        ],
        latitude: Number(row.currentLocation.latitude),
        longitude: Number(row.currentLocation.longitude),
        recordedAt: row.currentLocation.recordedAt,
      })),
      generatedAt: new Date(),
    };
  }

  /** Staff accounts and the paid revenue collected in the zones assigned to them. */
  private async teamEarnings(range: ResolvedRange) {
    const access = this.access.current();
    const admins = await this.adminRepo.find({
      where: { isActive: true },
      order: { firstName: 'ASC', email: 'ASC' },
    });
    const zoneMap = await this.access.zonesFor(admins.map((admin) => admin.id));

    const earningQb = this.paymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.booking', 'booking')
      .select('booking.service_area_id', 'zoneId')
      .addSelect('COALESCE(SUM(payment.amount), 0)', 'earnings')
      .where('payment.paymentStatus = :status', { status: 'PAID' })
      .andWhere('payment.paidAt BETWEEN :start AND :end', {
        start: range.start,
        end: range.end,
      })
      .groupBy('booking.service_area_id');
    this.access.restrictZoneColumn(earningQb, 'booking.service_area_id');
    const earningRows = await earningQb.getRawMany<{
      zoneId: string | null;
      earnings: string;
    }>();
    const byZone = new Map(
      earningRows
        .filter((row) => row.zoneId)
        .map((row) => [row.zoneId as string, Number(row.earnings)]),
    );
    const visibleTotal = [...byZone.values()].reduce((sum, amount) => sum + amount, 0);

    return admins
      .map((admin) => {
        const zones = zoneMap.get(admin.id) ?? [];
        const unrestricted = admin.role === 'SUPER_ADMIN';
        const earnings = unrestricted
          ? visibleTotal
          : zones.reduce((sum, zone) => sum + (byZone.get(zone.id) ?? 0), 0);
        return {
          id: admin.id,
          name:
            [admin.firstName, admin.lastName].filter(Boolean).join(' ').trim() ||
            admin.email,
          email: admin.email,
          role: admin.role,
          unrestricted,
          zones: unrestricted
            ? []
            : zones.map((zone) => ({ id: zone.id, name: zone.name, city: zone.city })),
          earnings,
        };
      })
      .filter((person) => {
        if (access.unrestricted) return true;
        if (person.id === access.adminId) return true;
        return person.zones.some((zone) => access.zoneIds.includes(zone.id));
      })
      .sort((a, b) => b.earnings - a.earnings);
  }

  private async customerStats(range: ResolvedRange) {
    const totalQb = this.customerRepo.createQueryBuilder('customer');
    const newQb = this.customerRepo
      .createQueryBuilder('customer')
      .where('customer.createdAt BETWEEN :start AND :end', {
        start: range.start,
        end: range.end,
      });
    const blockedQb = this.customerRepo
      .createQueryBuilder('customer')
      .innerJoin('customer.user', 'user')
      .where('user.isActive = false');
    this.access.restrictCustomer(totalQb, 'customer');
    this.access.restrictCustomer(newQb, 'customer');
    this.access.restrictCustomer(blockedQb, 'customer');

    const [total, newInRange, blocked] = await Promise.all([
      totalQb.getCount(),
      newQb.getCount(),
      blockedQb.getCount(),
    ]);

    return { total, newInRange, blocked };
  }

  private async agentStats(range: ResolvedRange) {
    const statusQb = this.agentRepo
      .createQueryBuilder('agent')
      .select('agent.approvalStatus', 'approvalStatus')
      .addSelect('agent.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('agent.approvalStatus')
      .addGroupBy('agent.status');
    this.access.restrictAgent(statusQb, 'agent');
    const statusRows = await statusQb.getRawMany<{
        approvalStatus: string;
        status: string;
        count: number;
      }>();

    const sumWhere = (
      predicate: (row: { approvalStatus: string; status: string }) => boolean,
    ) =>
      statusRows
        .filter(predicate)
        .reduce((total, row) => total + Number(row.count), 0);

    const onlineQb = this.attendanceRepo
      .createQueryBuilder('attendance')
      .innerJoin('attendance.agent', 'agent')
      .select('COUNT(DISTINCT attendance.agentId)::int', 'count')
      .where('attendance.attendanceDate = :today', { today: range.today })
      .andWhere('attendance.checkIn IS NOT NULL');
    this.access.restrictAgent(onlineQb, 'agent');
    const onlineToday = await onlineQb.getRawOne<{ count: number }>();

    return {
      total: sumWhere(() => true),
      approved: sumWhere((row) => row.approvalStatus === 'APPROVED'),
      pendingApproval: sumWhere((row) => row.approvalStatus === 'PENDING'),
      suspended: sumWhere((row) => row.status === 'SUSPENDED'),
      onlineToday: Number(onlineToday?.count ?? 0),
    };
  }

  private async bookingStats(range: ResolvedRange) {
    const statusQb = this.bookingRepo
      .createQueryBuilder('booking')
      .select('booking.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('booking.status');
    this.access.restrictZoneColumn(statusQb, 'booking.service_area_id');
    const statusRows = await statusQb.getRawMany<{ status: string; count: number }>();

    const byStatus = statusRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {});

    const inRangeQb = this.bookingRepo
      .createQueryBuilder('booking')
      .where('booking.bookingDate BETWEEN :from AND :to', {
        from: range.from,
        to: range.to,
      });
    const activeQb = this.bookingRepo
      .createQueryBuilder('booking')
      .where('booking.status IN (:...statuses)', {
        statuses: ACTIVE_STATUSES,
      });
    this.access.restrictZoneColumn(inRangeQb, 'booking.service_area_id');
    this.access.restrictZoneColumn(activeQb, 'booking.service_area_id');
    const [inRange, activeNow] = await Promise.all([
      inRangeQb.getCount(),
      activeQb.getCount(),
    ]);

    return {
      total: statusRows.reduce((total, row) => total + Number(row.count), 0),
      byStatus,
      inRange,
      activeNow,
    };
  }

  private async revenueStats(range: ResolvedRange) {
    const collected = (from?: Date) => {
      const qb = this.paymentRepo
        .createQueryBuilder('payment')
        .innerJoin('payment.booking', 'booking')
        .select('COALESCE(SUM(payment.amount), 0)', 'total')
        .where('payment.paymentStatus = :status', { status: 'PAID' });
      if (from) {
        qb.andWhere('payment.paidAt >= :from', { from });
      }
      this.access.restrictZoneColumn(qb, 'booking.service_area_id');
      return qb.getRawOne<{ total: string }>();
    };

    const [today, inRange, thisMonth, lifetime, pending] = await Promise.all([
      collected(range.startOfToday),
      (() => {
        const qb = this.paymentRepo
          .createQueryBuilder('payment')
          .innerJoin('payment.booking', 'booking')
          .select('COALESCE(SUM(payment.amount), 0)', 'total')
          .where('payment.paymentStatus = :status', { status: 'PAID' })
          .andWhere('payment.paidAt BETWEEN :start AND :end', {
            start: range.start,
            end: range.end,
          });
        this.access.restrictZoneColumn(qb, 'booking.service_area_id');
        return qb.getRawOne<{ total: string }>();
      })(),
      collected(range.startOfMonth),
      collected(),
      (() => {
        const qb = this.paymentRepo
          .createQueryBuilder('payment')
          .innerJoin('payment.booking', 'booking')
          .select('COALESCE(SUM(payment.amount), 0)', 'total')
          .where('payment.paymentStatus = :status', { status: 'PENDING' });
        this.access.restrictZoneColumn(qb, 'booking.service_area_id');
        return qb.getRawOne<{ total: string }>();
      })(),
    ]);

    return {
      today: Number(today?.total ?? 0),
      inRange: Number(inRange?.total ?? 0),
      thisMonth: Number(thisMonth?.total ?? 0),
      lifetime: Number(lifetime?.total ?? 0),
      pendingCollection: Number(pending?.total ?? 0),
    };
  }

  private async ratingStats() {
    const ratingQb = this.ratingRepo
      .createQueryBuilder('rating')
      .innerJoin('rating.booking', 'booking')
      .select('COALESCE(AVG(rating.rating), 0)', 'average')
      .addSelect('COUNT(*)::int', 'count');
    this.access.restrictZoneColumn(ratingQb, 'booking.service_area_id');
    const row = await ratingQb.getRawOne<{ average: string; count: number }>();

    return {
      average: Number(Number(row?.average ?? 0).toFixed(2)),
      count: Number(row?.count ?? 0),
    };
  }

  private async supportStats() {
    const ticketQb = this.ticketRepo
      .createQueryBuilder('ticket')
      .innerJoin('ticket.user', 'user')
      .leftJoin('user.customer', 'customer')
      .leftJoin('user.agent', 'agent')
      .leftJoin('ticket.booking', 'booking')
      .select('ticket.status', 'status')
      .addSelect('ticket.priority', 'priority')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('ticket.status')
      .addGroupBy('ticket.priority');
    this.access.restrictSupport(ticketQb);
    const rows = await ticketQb.getRawMany<{
      status: string;
      priority: string;
      count: number;
    }>();

    const sumWhere = (
      predicate: (row: { status: string; priority: string }) => boolean,
    ) =>
      rows
        .filter(predicate)
        .reduce((total, row) => total + Number(row.count), 0);

    return {
      open: sumWhere((row) => row.status === 'OPEN'),
      inProgress: sumWhere((row) => row.status === 'IN_PROGRESS'),
      highPriority: sumWhere(
        (row) =>
          HIGH_PRIORITIES.includes(row.priority) &&
          row.status !== 'RESOLVED' &&
          row.status !== 'CLOSED',
      ),
    };
  }

  private async kycStats() {
    const documentQb = this.documentRepo
      .createQueryBuilder('document')
      .innerJoin('document.agent', 'agent')
      .where('document.verificationStatus = :status', { status: 'PENDING' });
    this.access.restrictAgent(documentQb, 'agent');
    const pendingDocuments = await documentQb.getCount();

    return { pendingDocuments };
  }

  /** Defaults to the current calendar month when the caller sends nothing. */
  private resolveRange(query: AdminDashboardQueryDto): ResolvedRange {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const from = query.from ?? isoDate(startOfMonth);
    const to = query.to ?? isoDate(endOfMonth);

    return {
      from,
      to,
      start: new Date(`${from}T00:00:00.000Z`),
      end: new Date(`${to}T23:59:59.999Z`),
      today: isoDate(now),
      startOfToday: new Date(`${isoDate(now)}T00:00:00.000Z`),
      startOfMonth: new Date(`${isoDate(startOfMonth)}T00:00:00.000Z`),
    };
  }
}

interface ResolvedRange {
  from: string;
  to: string;
  start: Date;
  end: Date;
  today: string;
  startOfToday: Date;
  startOfMonth: Date;
}
