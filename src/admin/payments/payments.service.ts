import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Payment } from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { ListAdminPaymentsDto } from './dto/list-payments.dto';

interface PaymentListRow {
  id: string;
  bookingId: string;
  bookingNumber: string;
  customerId: string;
  customerFirstName: string | null;
  customerLastName: string | null;
  customerMobile: string;
  amount: string;
  paymentMethod: string | null;
  paymentStatus: string;
  paidAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class AdminPaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly access: AdminAccessService,
  ) {}

  async list(query: ListAdminPaymentsDto) {
    const { skip, take } = skipTake(query);

    const rowsQb = this.applyFilters(this.baseQuery(), query)
      .select('payment.id', 'id')
      .addSelect('payment.bookingId', 'bookingId')
      .addSelect('booking.bookingNumber', 'bookingNumber')
      .addSelect('payment.customerId', 'customerId')
      .addSelect('customer.firstName', 'customerFirstName')
      .addSelect('customer.lastName', 'customerLastName')
      .addSelect('customerUser.mobile', 'customerMobile')
      .addSelect('payment.amount', 'amount')
      .addSelect('payment.paymentMethod', 'paymentMethod')
      .addSelect('payment.paymentStatus', 'paymentStatus')
      .addSelect('payment.paidAt', 'paidAt')
      .addSelect('payment.createdAt', 'createdAt')
      .orderBy('payment.createdAt', 'DESC')
      .offset(skip)
      .limit(take);

    const totalsQb = this.applyFilters(this.baseQuery(), query)
      .select(
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
      .addSelect('COUNT(*)::int', 'count');

    const [rows, total, totals] = await Promise.all([
      rowsQb.getRawMany<PaymentListRow>(),
      this.applyFilters(this.baseQuery(), query).getCount(),
      totalsQb.getRawOne<{
        collected: string;
        pending: string;
        refunded: string;
        count: number;
      }>(),
    ]);

    const page = paginated(
      rows.map((row) => ({
        id: row.id,
        bookingId: row.bookingId,
        bookingNumber: row.bookingNumber,
        customerId: row.customerId,
        customerName: this.fullName(
          row.customerFirstName,
          row.customerLastName,
        ),
        customerMobile: row.customerMobile,
        amount: Number(row.amount),
        paymentMethod: row.paymentMethod,
        paymentStatus: row.paymentStatus,
        paidAt: row.paidAt,
        createdAt: row.createdAt,
      })),
      total,
      query,
    );

    return {
      ...page,
      totals: {
        collected: Number(totals?.collected ?? 0),
        pending: Number(totals?.pending ?? 0),
        refunded: Number(totals?.refunded ?? 0),
        count: Number(totals?.count ?? 0),
      },
    };
  }

  async detail(id: string) {
    const payment = await this.paymentRepo.findOne({
      where: { id },
      relations: ['booking', 'customer', 'customer.user', 'transactions'],
    });
    if (!payment) throw new NotFoundException('Payment not found');
    this.access.assertZone(payment.booking?.serviceAreaId, 'Payment');

    return {
      id: payment.id,
      amount: Number(payment.amount),
      paymentMethod: payment.paymentMethod,
      paymentStatus: payment.paymentStatus,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      booking: payment.booking
        ? {
            id: payment.booking.id,
            bookingNumber: payment.booking.bookingNumber,
            bookingDate: payment.booking.bookingDate,
            startTime: payment.booking.startTime,
            status: payment.booking.status,
            paymentStatus: payment.booking.paymentStatus,
            totalAmount: Number(payment.booking.totalAmount),
          }
        : null,
      customer: payment.customer
        ? {
            customerId: payment.customer.id,
            userId: payment.customer.userId,
            name: this.fullName(
              payment.customer.firstName,
              payment.customer.lastName,
            ),
            mobile: payment.customer.user?.mobile ?? null,
            email: payment.customer.user?.email ?? null,
          }
        : null,
      transactions: (payment.transactions ?? [])
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((txn) => ({
          id: txn.id,
          gatewayName: txn.gatewayName,
          gatewayTransactionId: txn.gatewayTransactionId,
          gatewayResponse: txn.gatewayResponse,
          status: txn.status,
          createdAt: txn.createdAt,
        })),
    };
  }

  private baseQuery() {
    return this.paymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.booking', 'booking')
      .innerJoin('payment.customer', 'customer')
      .innerJoin('customer.user', 'customerUser');
  }

  private applyFilters(
    qb: SelectQueryBuilder<Payment>,
    query: ListAdminPaymentsDto,
  ) {
    if (query.search) {
      qb.andWhere('booking.bookingNumber ILIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }
    if (query.paymentStatus) {
      qb.andWhere('payment.paymentStatus = :paymentStatus', {
        paymentStatus: query.paymentStatus,
      });
    }
    if (query.paymentMethod) {
      qb.andWhere('payment.paymentMethod = :paymentMethod', {
        paymentMethod: query.paymentMethod,
      });
    }
    if (query.from) {
      qb.andWhere('payment.createdAt >= :from', {
        from: new Date(`${query.from}T00:00:00.000Z`),
      });
    }
    if (query.to) {
      qb.andWhere('payment.createdAt <= :to', {
        to: new Date(`${query.to}T23:59:59.999Z`),
      });
    }
    this.access.restrictZoneColumn(qb, 'booking.service_area_id');
    return qb;
  }

  private fullName(firstName: string | null, lastName: string | null) {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  }
}
