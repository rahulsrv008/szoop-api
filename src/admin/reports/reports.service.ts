import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AgentAttendance,
  AgentEarning,
  Booking,
  BookingItem,
  Customer,
  Payment,
  Rating,
} from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { AdminReportRangeDto } from './dto/report-range.dto';

const DEFAULT_RANGE_DAYS = 30;

interface ResolvedRange {
  from: string;
  to: string;
  start: Date;
  end: Date;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

/**
 * Everything here is computed with SQL aggregation — no report ever loads
 * booking or payment rows into memory.
 */
@Injectable()
export class AdminReportsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingItem)
    private readonly bookingItemRepo: Repository<BookingItem>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(AgentEarning)
    private readonly earningRepo: Repository<AgentEarning>,
    @InjectRepository(AgentAttendance)
    private readonly attendanceRepo: Repository<AgentAttendance>,
    @InjectRepository(Rating) private readonly ratingRepo: Repository<Rating>,
    private readonly access: AdminAccessService,
  ) {}

  /** Summary-level roll-up of the four detailed reports. */
  async overview(query: AdminReportRangeDto) {
    const range = this.resolveRange(query);

    const [bookings, revenue, agents, customers] = await Promise.all([
      this.bookingSeries(range),
      this.revenueReport(range),
      this.agentRows(range),
      this.customerReport(range),
    ]);

    const bookingTotals = bookings.reduce(
      (acc, row) => ({
        total: acc.total + row.total,
        completed: acc.completed + row.completed,
        cancelled: acc.cancelled + row.cancelled,
        revenue: acc.revenue + row.revenue,
      }),
      { total: 0, completed: 0, cancelled: 0, revenue: 0 },
    );

    return {
      range: { from: range.from, to: range.to },
      bookings: {
        total: bookingTotals.total,
        completed: bookingTotals.completed,
        cancelled: bookingTotals.cancelled,
        completedRevenue: Number(bookingTotals.revenue.toFixed(2)),
        days: bookings.length,
      },
      revenue: revenue.totals,
      topServices: revenue.topServices,
      agents: {
        activeAgents: agents.length,
        completedJobs: agents.reduce((sum, row) => sum + row.completedJobs, 0),
        hours: Number(
          agents.reduce((sum, row) => sum + row.hours, 0).toFixed(2),
        ),
        revenueGenerated: Number(
          agents.reduce((sum, row) => sum + row.revenueGenerated, 0).toFixed(2),
        ),
        earnings: Number(
          agents.reduce((sum, row) => sum + row.earnings, 0).toFixed(2),
        ),
        topAgents: agents.slice(0, 5),
      },
      customers: {
        newCustomers: customers.totals.newCustomers,
        repeatCustomers: customers.totals.repeatCustomers,
        payingCustomers: customers.totals.payingCustomers,
        totalSpend: customers.totals.totalSpend,
        topCustomers: customers.topCustomers.slice(0, 5),
      },
    };
  }

  async bookingsReport(query: AdminReportRangeDto) {
    const range = this.resolveRange(query);
    const series = await this.bookingSeries(range);

    return {
      range: { from: range.from, to: range.to },
      series,
      totals: series.reduce(
        (acc, row) => ({
          total: acc.total + row.total,
          completed: acc.completed + row.completed,
          cancelled: acc.cancelled + row.cancelled,
          revenue: Number((acc.revenue + row.revenue).toFixed(2)),
        }),
        { total: 0, completed: 0, cancelled: 0, revenue: 0 },
      ),
    };
  }

  async revenue(query: AdminReportRangeDto) {
    const range = this.resolveRange(query);
    const report = await this.revenueReport(range);
    return { range: { from: range.from, to: range.to }, ...report };
  }

  async agents(query: AdminReportRangeDto) {
    const range = this.resolveRange(query);
    const items = await this.agentRows(range);
    return { range: { from: range.from, to: range.to }, items };
  }

  async customers(query: AdminReportRangeDto) {
    const range = this.resolveRange(query);
    const report = await this.customerReport(range);
    return { range: { from: range.from, to: range.to }, ...report };
  }

  private async bookingSeries(range: ResolvedRange) {
    const bookingQb = this.bookingRepo
      .createQueryBuilder('booking')
      .select(`to_char(booking.bookingDate, 'YYYY-MM-DD')`, 'date')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect(
        `SUM(CASE WHEN booking.status = 'completed' THEN 1 ELSE 0 END)::int`,
        'completed',
      )
      .addSelect(
        `SUM(CASE WHEN booking.status = 'cancelled' THEN 1 ELSE 0 END)::int`,
        'cancelled',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN booking.status = 'completed' THEN booking.totalAmount ELSE 0 END), 0)`,
        'revenue',
      )
      .where('booking.bookingDate BETWEEN :from AND :to', {
        from: range.from,
        to: range.to,
      })
      .groupBy('booking.bookingDate')
      .orderBy('booking.bookingDate', 'ASC');
    this.access.restrictZoneColumn(bookingQb, 'booking.service_area_id');
    const rows = await bookingQb.getRawMany<{
        date: string;
        total: number;
        completed: number;
        cancelled: number;
        revenue: string;
      }>();

    return rows.map((row) => ({
      date: row.date,
      total: Number(row.total),
      completed: Number(row.completed),
      cancelled: Number(row.cancelled),
      revenue: Number(row.revenue),
    }));
  }

  private async revenueReport(range: ResolvedRange) {
    const dailyQb = this.paymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.booking', 'booking')
      .select(
        `to_char(COALESCE(payment.paidAt, payment.createdAt), 'YYYY-MM-DD')`,
        'date',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN payment.paymentStatus = 'PAID' THEN payment.amount ELSE 0 END), 0)`,
        'collected',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN payment.paymentStatus = 'PENDING' THEN payment.amount ELSE 0 END), 0)`,
        'pending',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN payment.paymentStatus = 'REFUNDED' THEN payment.amount ELSE 0 END), 0)`,
        'refunded',
      )
      .addSelect('COUNT(*)::int', 'count')
      .where(
        'COALESCE(payment.paidAt, payment.createdAt) BETWEEN :start AND :end',
        { start: range.start, end: range.end },
      )
      .groupBy(
        `to_char(COALESCE(payment.paidAt, payment.createdAt), 'YYYY-MM-DD')`,
      )
      .orderBy(
        `to_char(COALESCE(payment.paidAt, payment.createdAt), 'YYYY-MM-DD')`,
        'ASC',
      );
    this.access.restrictZoneColumn(dailyQb, 'booking.service_area_id');
    const dailyRows = await dailyQb.getRawMany<{
        date: string;
        collected: string;
        pending: string;
        refunded: string;
        count: number;
      }>();

    const topQb = this.bookingItemRepo
      .createQueryBuilder('item')
      .innerJoin('item.booking', 'booking')
      .innerJoin('item.service', 'service')
      .select('item.serviceId', 'serviceId')
      .addSelect('service.name', 'serviceName')
      .addSelect('COUNT(*)::int', 'bookings')
      .addSelect('COALESCE(SUM(item.amount), 0)', 'revenue')
      .where('booking.bookingDate BETWEEN :from AND :to', {
        from: range.from,
        to: range.to,
      })
      .andWhere('booking.status = :status', { status: 'completed' })
      .groupBy('item.serviceId')
      .addGroupBy('service.name')
      .orderBy('revenue', 'DESC')
      .limit(5);
    this.access.restrictZoneColumn(topQb, 'booking.service_area_id');
    const topServiceRows = await topQb.getRawMany<{
        serviceId: string;
        serviceName: string;
        bookings: number;
        revenue: string;
      }>();

    const series = dailyRows.map((row) => ({
      date: row.date,
      collected: Number(row.collected),
      pending: Number(row.pending),
      refunded: Number(row.refunded),
      count: Number(row.count),
    }));

    return {
      series,
      totals: {
        collected: Number(
          series.reduce((sum, row) => sum + row.collected, 0).toFixed(2),
        ),
        pending: Number(
          series.reduce((sum, row) => sum + row.pending, 0).toFixed(2),
        ),
        refunded: Number(
          series.reduce((sum, row) => sum + row.refunded, 0).toFixed(2),
        ),
        count: series.reduce((sum, row) => sum + row.count, 0),
      },
      topServices: topServiceRows.map((row) => ({
        serviceId: row.serviceId,
        serviceName: row.serviceName,
        bookings: Number(row.bookings),
        revenue: Number(row.revenue),
      })),
    };
  }

  private async agentRows(range: ResolvedRange) {
    const earningQb = this.earningRepo
      .createQueryBuilder('earning')
      .innerJoin('earning.agent', 'agent')
      .select('earning.agentId', 'agentId')
      .addSelect('agent.firstName', 'firstName')
      .addSelect('agent.lastName', 'lastName')
      .addSelect('COUNT(DISTINCT earning.bookingId)::int', 'completedJobs')
      .addSelect('COALESCE(SUM(earning.serviceHours), 0)', 'hours')
      .addSelect('COALESCE(SUM(earning.revenueGenerated), 0)', 'revenue')
      .addSelect('COALESCE(SUM(earning.earningAmount), 0)', 'earnings')
      .where('earning.earningDate BETWEEN :from AND :to', {
        from: range.from,
        to: range.to,
      })
      .groupBy('earning.agentId')
      .addGroupBy('agent.firstName')
      .addGroupBy('agent.lastName')
      .orderBy('revenue', 'DESC');
    this.access.restrictAgent(earningQb, 'agent');
    const rows = await earningQb.getRawMany<{
        agentId: string;
        firstName: string;
        lastName: string | null;
        completedJobs: number;
        hours: string;
        revenue: string;
        earnings: string;
      }>();

    if (!rows.length) return [];

    const agentIds = rows.map((row) => row.agentId);

    const [ratingRows, attendanceRows] = await Promise.all([
      this.ratingRepo
        .createQueryBuilder('rating')
        .select('rating.agentId', 'agentId')
        .addSelect('COALESCE(AVG(rating.rating), 0)', 'average')
        .where('rating.agentId IN (:...agentIds)', { agentIds })
        .andWhere('rating.createdAt BETWEEN :start AND :end', {
          start: range.start,
          end: range.end,
        })
        .groupBy('rating.agentId')
        .getRawMany<{ agentId: string; average: string }>(),
      this.attendanceRepo
        .createQueryBuilder('attendance')
        .select('attendance.agentId', 'agentId')
        .addSelect('COUNT(DISTINCT attendance.attendanceDate)::int', 'days')
        .where('attendance.agentId IN (:...agentIds)', { agentIds })
        .andWhere('attendance.attendanceDate BETWEEN :from AND :to', {
          from: range.from,
          to: range.to,
        })
        .groupBy('attendance.agentId')
        .getRawMany<{ agentId: string; days: number }>(),
    ]);

    const averageByAgent = new Map(
      ratingRows.map((row) => [row.agentId, Number(row.average)]),
    );
    const daysByAgent = new Map(
      attendanceRows.map((row) => [row.agentId, Number(row.days)]),
    );

    return rows.map((row) => ({
      agentId: row.agentId,
      name:
        [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || null,
      completedJobs: Number(row.completedJobs),
      hours: Number(row.hours),
      revenueGenerated: Number(row.revenue),
      earnings: Number(row.earnings),
      averageRating: Number((averageByAgent.get(row.agentId) ?? 0).toFixed(2)),
      attendanceDays: daysByAgent.get(row.agentId) ?? 0,
    }));
  }

  private async customerReport(range: ResolvedRange) {
    const access = this.access.current();
    const [newRows, repeatRow, spendRow, topRows] = await Promise.all([
      (() => {
        const qb = this.customerRepo
          .createQueryBuilder('customer')
          .select(`to_char(customer.createdAt, 'YYYY-MM-DD')`, 'date')
          .addSelect('COUNT(*)::int', 'count')
          .where('customer.createdAt BETWEEN :start AND :end', {
            start: range.start,
            end: range.end,
          })
          .groupBy(`to_char(customer.createdAt, 'YYYY-MM-DD')`)
          .orderBy(`to_char(customer.createdAt, 'YYYY-MM-DD')`, 'ASC');
        this.access.restrictCustomer(qb, 'customer');
        return qb.getRawMany<{ date: string; count: number }>();
      })(),
      // Customers with more than one booking inside the window.
      this.bookingRepo.manager
        .createQueryBuilder()
        .select('COUNT(*)::int', 'count')
        .from(
          (sub) =>
            sub
              .select('inner_booking.customer_id', 'customerId')
              .from('bookings', 'inner_booking')
              .where('inner_booking.booking_date BETWEEN :from AND :to')
              .andWhere(
                access.unrestricted
                  ? '1 = 1'
                  : access.zoneIds.length
                    ? 'inner_booking.service_area_id IN (:...scopeZoneIds)'
                    : '1 = 0',
              )
              .groupBy('inner_booking.customer_id')
              .having('COUNT(*) > 1'),
          'repeat_customers',
        )
        .setParameters({
          from: range.from,
          to: range.to,
          scopeZoneIds: access.zoneIds.length
            ? access.zoneIds
            : ['00000000-0000-0000-0000-000000000000'],
        })
        .getRawOne<{ count: number }>(),
      (() => {
        const qb = this.paymentRepo
          .createQueryBuilder('payment')
          .innerJoin('payment.booking', 'booking')
          .select('COUNT(DISTINCT payment.customerId)::int', 'customers')
          .addSelect('COALESCE(SUM(payment.amount), 0)', 'spend')
          .where('payment.paymentStatus = :status', { status: 'PAID' })
          .andWhere(
            'COALESCE(payment.paidAt, payment.createdAt) BETWEEN :start AND :end',
            { start: range.start, end: range.end },
          );
        this.access.restrictZoneColumn(qb, 'booking.service_area_id');
        return qb.getRawOne<{ customers: number; spend: string }>();
      })(),
      (() => {
        const qb = this.paymentRepo
          .createQueryBuilder('payment')
          .innerJoin('payment.booking', 'booking')
          .innerJoin('payment.customer', 'customer')
          .innerJoin('customer.user', 'customerUser');
        this.access.restrictZoneColumn(qb, 'booking.service_area_id');
        return qb
        .select('payment.customerId', 'customerId')
        .addSelect('customer.firstName', 'firstName')
        .addSelect('customer.lastName', 'lastName')
        .addSelect('customerUser.mobile', 'mobile')
        .addSelect('COUNT(*)::int', 'payments')
        .addSelect('COALESCE(SUM(payment.amount), 0)', 'spend')
        .where('payment.paymentStatus = :status', { status: 'PAID' })
        .andWhere(
          'COALESCE(payment.paidAt, payment.createdAt) BETWEEN :start AND :end',
          { start: range.start, end: range.end },
        )
        .groupBy('payment.customerId')
        .addGroupBy('customer.firstName')
        .addGroupBy('customer.lastName')
        .addGroupBy('customerUser.mobile')
        .orderBy('spend', 'DESC')
        .limit(10)
        .getRawMany<{
          customerId: string;
          firstName: string | null;
          lastName: string | null;
          mobile: string;
          payments: number;
          spend: string;
        }>();
      })(),
    ]);

    const newCustomers = newRows.map((row) => ({
      date: row.date,
      count: Number(row.count),
    }));
    const topCustomers = topRows.map((row) => ({
      customerId: row.customerId,
      name:
        [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || null,
      mobile: row.mobile,
      payments: Number(row.payments),
      spend: Number(row.spend),
    }));

    return {
      newCustomers,
      topCustomers,
      totals: {
        newCustomers: newCustomers.reduce((sum, row) => sum + row.count, 0),
        repeatCustomers: Number(repeatRow?.count ?? 0),
        payingCustomers: Number(spendRow?.customers ?? 0),
        totalSpend: Number(spendRow?.spend ?? 0),
      },
    };
  }

  /** Defaults to the last 30 days (inclusive of today). */
  private resolveRange(query: AdminReportRangeDto): ResolvedRange {
    const now = new Date();
    const to = query.to ?? isoDate(now);
    const from =
      query.from ??
      isoDate(new Date(now.getTime() - (DEFAULT_RANGE_DAYS - 1) * 86400000));

    return {
      from,
      to,
      start: new Date(`${from}T00:00:00.000Z`),
      end: new Date(`${to}T23:59:59.999Z`),
    };
  }
}
