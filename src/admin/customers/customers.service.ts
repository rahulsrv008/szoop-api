import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository, SelectQueryBuilder } from 'typeorm';
import {
  Booking,
  Customer,
  CustomerAddress,
  Payment,
  User,
} from 'src/database/entities';
import { AuditService } from 'src/common/services/audit.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { ZoneResolverService } from 'src/common/services/zone-resolver.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { ListAdminCustomersDto } from './dto/list-customers.dto';
import { UpdateAdminCustomerDto } from './dto/update-customer.dto';
import { BlockAdminCustomerDto } from './dto/block-customer.dto';

interface CustomerListRow {
  customerId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  mobile: string;
  email: string | null;
  isActive: boolean;
  totalBookings: number;
  lastBookingDate: string | null;
  createdAt: Date;
  homeZoneId: string | null;
}

@Injectable()
export class AdminCustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(CustomerAddress)
    private readonly addressRepo: Repository<CustomerAddress>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationDispatchService,
    private readonly zones: ZoneResolverService,
    private readonly access: AdminAccessService,
  ) {}

  async list(query: ListAdminCustomersDto) {
    const { skip, take } = skipTake(query);

    const rowsQb = this.applyFilters(
      this.customerRepo
        .createQueryBuilder('customer')
        .innerJoin('customer.user', 'user')
        .leftJoin(Booking, 'booking', 'booking.customerId = customer.id'),
      query,
    )
      .select('customer.id', 'customerId')
      .addSelect('customer.userId', 'userId')
      .addSelect('customer.firstName', 'firstName')
      .addSelect('customer.lastName', 'lastName')
      .addSelect('user.mobile', 'mobile')
      .addSelect('user.email', 'email')
      .addSelect('user.isActive', 'isActive')
      .addSelect('customer.createdAt', 'createdAt')
      .addSelect('customer.homeZoneId', 'homeZoneId')
      .addSelect('COUNT(booking.id)::int', 'totalBookings')
      // `date` columns are returned as text so the API keeps YYYY-MM-DD.
      .addSelect(
        `to_char(MAX(booking.bookingDate), 'YYYY-MM-DD')`,
        'lastBookingDate',
      )
      .groupBy('customer.id')
      .addGroupBy('user.id')
      .orderBy('customer.createdAt', 'DESC')
      .offset(skip)
      .limit(take);

    const countQb = this.applyFilters(
      this.customerRepo
        .createQueryBuilder('customer')
        .innerJoin('customer.user', 'user'),
      query,
    );

    const [rows, total] = await Promise.all([
      rowsQb.getRawMany<CustomerListRow>(),
      countQb.getCount(),
    ]);

    const zoneMap = await this.zones.summariesById(rows.map((row) => row.homeZoneId));

    return paginated(
      rows.map((row) => ({
        customerId: row.customerId,
        userId: row.userId,
        name: this.fullName(row.firstName, row.lastName),
        mobile: row.mobile,
        email: row.email,
        isActive: row.isActive,
        totalBookings: Number(row.totalBookings),
        lastBookingDate: row.lastBookingDate,
        createdAt: row.createdAt,
        homeZone: row.homeZoneId ? zoneMap.get(row.homeZoneId) ?? null : null,
      })),
      total,
      query,
    );
  }

  async detail(id: string) {
    const customer = await this.requireCustomer(id);

    const [addresses, statusRows, spent, recentBookings] = await Promise.all([
      this.addressRepo.find({
        where: { customerId: id },
        relations: ['serviceArea'],
        order: { isDefault: 'DESC', createdAt: 'DESC' },
      }),
      this.bookingRepo
        .createQueryBuilder('booking')
        .select('booking.status', 'status')
        .addSelect('COUNT(*)::int', 'count')
        .where('booking.customerId = :id', { id })
        .groupBy('booking.status')
        .getRawMany<{ status: string; count: number }>(),
      this.paymentRepo
        .createQueryBuilder('payment')
        .select('COALESCE(SUM(payment.amount), 0)', 'total')
        .where('payment.customerId = :id', { id })
        .andWhere('payment.paymentStatus = :status', { status: 'PAID' })
        .getRawOne<{ total: string }>(),
      this.bookingRepo.find({
        where: { customerId: id },
        order: { bookingDate: 'DESC', startTime: 'DESC' },
        take: 10,
      }),
    ]);

    const byStatus = statusRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {});

    return {
      customerId: customer.id,
      userId: customer.userId,
      mobile: customer.user.mobile,
      email: customer.user.email,
      isActive: customer.user.isActive,
      firstName: customer.firstName,
      lastName: customer.lastName,
      name: this.fullName(customer.firstName, customer.lastName),
      profileImage: customer.profileImage,
      gender: customer.gender,
      dateOfBirth: customer.dateOfBirth,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      homeZone: await this.zones.summaryById(customer.homeZoneId),
      addresses: addresses.map((address) => ({
        id: address.id,
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        landmark: address.landmark,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        latitude: address.latitude,
        longitude: address.longitude,
        addressType: address.addressType,
        isDefault: address.isDefault,
        serviceAreaId: address.serviceAreaId,
        zone: this.zones.summary(address.serviceArea),
      })),
      counts: {
        bookings: byStatus,
        totalBookings: statusRows.reduce(
          (total, row) => total + Number(row.count),
          0,
        ),
        totalSpent: Number(spent?.total ?? 0),
      },
      recentBookings: recentBookings.map((booking) => ({
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        totalAmount: Number(booking.totalAmount),
      })),
    };
  }

  async update(adminId: string, id: string, dto: UpdateAdminCustomerDto) {
    const customer = await this.requireCustomer(id);

    const oldData = {
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.user.email,
      gender: customer.gender,
      dateOfBirth: customer.dateOfBirth,
    };

    if (dto.email !== undefined && dto.email !== customer.user.email) {
      const taken = await this.userRepo.findOne({
        where: { email: dto.email, id: Not(customer.userId) },
        select: ['id'],
      });
      if (taken) throw new ConflictException('Email already in use');
      customer.user.email = dto.email;
      await this.userRepo.save(customer.user);
    }

    if (dto.firstName !== undefined) customer.firstName = dto.firstName;
    if (dto.lastName !== undefined) customer.lastName = dto.lastName;
    if (dto.gender !== undefined) customer.gender = dto.gender;
    if (dto.dateOfBirth !== undefined) customer.dateOfBirth = dto.dateOfBirth;

    await this.customerRepo.save(customer);

    await this.audit.record({
      userId: adminId,
      action: 'CUSTOMER_UPDATED',
      entityType: 'customers',
      entityId: customer.id,
      oldData,
      newData: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.user.email,
        gender: customer.gender,
        dateOfBirth: customer.dateOfBirth,
      },
    });

    return this.detail(id);
  }

  async block(adminId: string, id: string, dto: BlockAdminCustomerDto) {
    const customer = await this.requireCustomer(id);
    const wasActive = customer.user.isActive;

    customer.user.isActive = false;
    await this.userRepo.save(customer.user);

    await this.notifications.toUser(customer.userId, {
      title: 'Account blocked',
      message: dto.reason
        ? `Your ClearIt account has been blocked. Reason: ${dto.reason}`
        : 'Your ClearIt account has been blocked. Please contact support.',
      type: 'account',
    });

    await this.audit.record({
      userId: adminId,
      action: 'CUSTOMER_BLOCKED',
      entityType: 'users',
      entityId: customer.userId,
      oldData: { isActive: wasActive },
      newData: { isActive: false, reason: dto.reason ?? null },
    });

    return {
      customerId: customer.id,
      userId: customer.userId,
      isActive: false,
      message: 'Customer blocked. Their API access is revoked immediately.',
    };
  }

  async unblock(adminId: string, id: string) {
    const customer = await this.requireCustomer(id);
    const wasActive = customer.user.isActive;

    customer.user.isActive = true;
    await this.userRepo.save(customer.user);

    await this.notifications.toUser(customer.userId, {
      title: 'Account restored',
      message: 'Your ClearIt account has been unblocked. Welcome back!',
      type: 'account',
    });

    await this.audit.record({
      userId: adminId,
      action: 'CUSTOMER_UNBLOCKED',
      entityType: 'users',
      entityId: customer.userId,
      oldData: { isActive: wasActive },
      newData: { isActive: true },
    });

    return {
      customerId: customer.id,
      userId: customer.userId,
      isActive: true,
      message: 'Customer unblocked.',
    };
  }

  private applyFilters(
    qb: SelectQueryBuilder<Customer>,
    query: ListAdminCustomersDto,
  ) {
    if (query.search) {
      qb.andWhere(
        `(customer.firstName ILIKE :search OR customer.lastName ILIKE :search
          OR user.mobile ILIKE :search OR user.email ILIKE :search)`,
        { search: `%${query.search.trim()}%` },
      );
    }
    if (query.isActive !== undefined) {
      qb.andWhere('user.isActive = :isActive', { isActive: query.isActive });
    }
    if (query.from) {
      qb.andWhere('customer.createdAt >= :from', {
        from: new Date(`${query.from}T00:00:00.000Z`),
      });
    }
    if (query.to) {
      qb.andWhere('customer.createdAt <= :to', {
        to: new Date(`${query.to}T23:59:59.999Z`),
      });
    }
    this.access.restrictCustomer(qb, 'customer');
    return qb;
  }

  private async requireCustomer(id: string) {
    const customer = await this.customerRepo.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!customer) throw new NotFoundException('Customer not found');
    await this.access.assertCustomer(customer.id, customer.homeZoneId);
    return customer;
  }

  private fullName(firstName: string | null, lastName: string | null) {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  }
}
