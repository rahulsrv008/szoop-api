import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import {
  Between,
  In,
  Like,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import {
  Booking,
  BookingItem,
  BookingVisit,
  Coupon,
  CouponUsage,
  CustomerAddress,
  HomeCategory,
  HomeCategoryOption,
  HomePricingTier,
  Payment,
  PaymentTransaction,
  Rating,
  BookingStatusHistory,
  SupportTicket,
  Service,
  ServiceArea,
  ServicePricing,
} from 'src/database/entities';
import { findBeautyService } from './beauty-catalog';
import { CreateBeautyBookingDto } from './dto/create-beauty-booking.dto';
import { CreatePlanBookingDto } from './dto/create-plan-booking.dto';
import { IdentityService } from 'src/common/auth/identity.service';
import { BookingHistoryService } from 'src/common/booking/booking-history.service';
import { WalletService } from 'src/common/services/wallet.service';
import { BookingClosureService, couponNote } from 'src/common/booking/booking-closure.service';
import {
  MAX_PAYMENT_ATTEMPTS,
  PAY_AFTER_SERVICE_MAX_AMOUNT,
  PAYMENT_WINDOW_MINUTES,
  RESCHEDULABLE,
} from 'src/common/booking/booking-status';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { ZoneResolverService } from 'src/common/services/zone-resolver.service';
import { ServiceabilityService } from 'src/common/services/serviceability.service';
import { DispatchService } from 'src/dispatch/dispatch.service';
import { EligibilityService } from 'src/dispatch/eligibility.service';
import { RELEASABLE_STATUSES } from 'src/dispatch/dispatch.rules';
import {
  SETTING_KEYS,
  SettingsService,
} from 'src/common/services/settings.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { CreateCustomerBookingDto } from './dto/create-booking.dto';
import { CancelCustomerBookingDto } from './dto/cancel-booking.dto';
import { ListCustomerBookingsQueryDto } from './dto/list-bookings.dto';
import { RescheduleCustomerBookingDto } from './dto/reschedule-booking.dto';
import { buildVisitPlan, freshOtp } from 'src/common/booking/booking-visits';

const DETAIL_RELATIONS = [
  'items',
  'items.service',
  'address',
  'payment',
  'agent',
  'agent.user',
  'ratings',
  'ratings.reviews',
];

/** Priced line as it is computed before the booking row exists. */
interface PricedItem {
  service: Service;
  quantity: number;
  durationMinutes: number;
  pricePerHour: number;
  amount: number;
}

@Injectable()
export class CustomerBookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingItem)
    private readonly bookingItemRepo: Repository<BookingItem>,
    @InjectRepository(BookingVisit)
    private readonly visitRepo: Repository<BookingVisit>,
    @InjectRepository(CustomerAddress)
    private readonly addressRepo: Repository<CustomerAddress>,
    @InjectRepository(Service)
    private readonly serviceRepo: Repository<Service>,
    @InjectRepository(ServicePricing)
    private readonly pricingRepo: Repository<ServicePricing>,
    @InjectRepository(ServiceArea)
    private readonly serviceAreaRepo: Repository<ServiceArea>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Coupon)
    private readonly couponRepo: Repository<Coupon>,
    @InjectRepository(CouponUsage)
    private readonly couponUsageRepo: Repository<CouponUsage>,
    @InjectRepository(Rating)
    private readonly ratingRepo: Repository<Rating>,
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(HomeCategory)
    private readonly homeCategoryRepo: Repository<HomeCategory>,
    @InjectRepository(HomeCategoryOption)
    private readonly homeOptionRepo: Repository<HomeCategoryOption>,
    private readonly identity: IdentityService,
    private readonly history: BookingHistoryService,
    private readonly notifications: NotificationDispatchService,
    private readonly settings: SettingsService,
    private readonly zones: ZoneResolverService,
    private readonly serviceability: ServiceabilityService,
    private readonly dispatch: DispatchService,
    private readonly eligibility: EligibilityService,
    private readonly wallet: WalletService,
    private readonly closure: BookingClosureService,
  ) {}

  async create(userId: string, dto: CreateCustomerBookingDto) {
    const customerId = await this.identity.requireCustomerId(userId);
    await this.assertNoDues(customerId);
    const address = await this.addressRepo.findOne({
      where: { id: dto.addressId, customerId },
    });
    if (!address) throw new NotFoundException('Address not found');

    if (dto.bookingDate < toDateString(new Date())) {
      throw new BadRequestException('bookingDate cannot be in the past');
    }
    const startTime = toTimeString(dto.startTime);

    const serviceArea = await this.resolveAddressZone(address);

    const priced = await this.priceItems(dto, serviceArea?.id ?? null);
    const subtotal = round2(
      priced.reduce((total, item) => total + item.amount, 0),
    );

    const coupon = dto.couponCode
      ? await this.resolveCoupon(dto.couponCode, subtotal)
      : null;
    const discount = coupon?.discount ?? 0;

    const taxPercent = await this.settings.getNumber(
      SETTING_KEYS.BOOKING_TAX_PERCENT,
      0,
    );
    const tax = round2(((subtotal - discount) * taxPercent) / 100);
    const totalAmount = round2(subtotal - discount + tax);

    const booking = await this.bookingRepo.save(
      this.bookingRepo.create({
        bookingNumber: await this.generateBookingNumber(),
        customerId,
        addressId: address.id,
        serviceAreaId: serviceArea?.id ?? null,
        bookingDate: dto.bookingDate,
        startTime,
        durationMinutes: priced.reduce(
          (total, item) => total + item.durationMinutes * item.quantity,
          0,
        ),
        subtotal: subtotal.toFixed(2),
        discount: discount.toFixed(2),
        tax: tax.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        paymentStatus: 'PENDING',
        status: 'finding',
        startOtp: String(randomInt(1000, 10000)),
        notes: dto.notes ?? null,
      }),
    );

    await this.bookingItemRepo.save(
      priced.map((item) =>
        this.bookingItemRepo.create({
          bookingId: booking.id,
          serviceId: item.service.id,
          quantity: item.quantity,
          durationMinutes: item.durationMinutes,
          pricePerHour: item.pricePerHour.toFixed(2),
          amount: item.amount.toFixed(2),
        }),
      ),
    );

    await this.paymentRepo.save(
      this.paymentRepo.create({
        bookingId: booking.id,
        customerId,
        amount: totalAmount.toFixed(2),
        paymentStatus: 'PENDING',
      }),
    );

    if (coupon) {
      await this.couponUsageRepo.save(
        this.couponUsageRepo.create({
          couponId: coupon.coupon.id,
          customerId,
          bookingId: booking.id,
          discountAmount: coupon.discount.toFixed(2),
        }),
      );
      await this.couponRepo.increment({ id: coupon.coupon.id }, 'usedCount', 1);
    }

    await this.attachVisits(booking);

    await this.history.record(
      booking.id,
      booking.status,
      userId,
      'Booking created by customer',
    );

    await this.notifications.toUser(userId, {
      title: 'Booking placed',
      message: `Booking ${booking.bookingNumber} is placed for ${booking.bookingDate} at ${booking.startTime}. Complete the payment so we can find an agent.`,
      type: 'booking',
      data: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
    });

    return this.detail(userId, booking.id);
  }

  /**
   * On Demand books today, starting shortly; monthly plans start tomorrow at the
   * shift's start time. The price always comes from the admin-managed tier.
   */
  async createPlan(userId: string, dto: CreatePlanBookingDto) {
    const customerId = await this.identity.requireCustomerId(userId);
    await this.assertNoDues(customerId);
    const address = await this.addressRepo.findOne({
      where: { id: dto.addressId, customerId },
    });
    if (!address) throw new NotFoundException('Address not found');

    const category = await this.homeCategoryRepo.findOne({
      where: { id: dto.categoryId, isActive: true },
    });
    if (!category) throw new NotFoundException('This service is unavailable');

    let option: HomeCategoryOption | null = null;
    if (dto.optionId) {
      option = await this.homeOptionRepo.findOne({
        where: { id: dto.optionId, categoryId: category.id, isActive: true },
      });
      if (!option) throw new NotFoundException('This plan is unavailable');
    }

    const serviceName = option?.title ?? category.title;
    const cookService = isCookService(serviceName);
    let tiers: HomePricingTier[] = [...((option ?? category).pricing ?? [])];
    if (cookService && !tiers.length) {
      tiers = [
        { label: 'Morning', subtitle: '6 AM – 11 AM', minutes: 45, startTime: '08:00', price: 1200 },
        { label: 'Evening', subtitle: '4:45 PM – 9:45 PM', minutes: 45, startTime: '16:45', price: 1200 },
        { label: 'Both', subtitle: 'Morning & evening', minutes: 45, startTime: '08:00', price: 2000 },
      ];
    }
    const tier = tiers[dto.tierIndex];
    if (!tier) {
      throw new BadRequestException('Please choose a valid option');
    }
    if (!cookService && !(Number(tier.price) > 0)) {
      throw new BadRequestException('Please choose a valid option');
    }

    const durationDays = cookService
      ? [3, 7, 14, 21, 28].includes(Number(dto.durationDays))
        ? Number(dto.durationDays)
        : 28
      : 28;

    if (cookService && durationDays <= 3 && (await this.customerUsedCookTrial(customerId))) {
      throw new BadRequestException('You have already used the 3-day Healthy Cook trial');
    }

    // Shift tiers carry a start time; duration tiers are On Demand.
    const planType = cookService || tier.startTime ? 'MONTHLY' : 'HOURLY';
    const { bookingDate, startTime, bookingMode } = cookService
      ? {
          bookingDate: planStartDate(dto.bookingDate),
          startTime: toTimeString(dto.startTime || tier.startTime || '08:00'),
          bookingMode: 'SCHEDULED' as const,
        }
      : planType === 'HOURLY'
        ? scheduledSlot(dto.bookingDate, dto.startTime)
        : {
            bookingDate: planStartDate(dto.bookingDate),
            startTime: toTimeString(tier.startTime || '08:00'),
            bookingMode: 'SCHEDULED' as const,
          };

    const cook = cookService
      ? cookCharge(
          dto.personCount ?? 1,
          await this.cookRate(tier.label),
          await this.settings.getNumber(
            SETTING_KEYS.COOK_EXTRA_PERSON_DISCOUNT_PERCENT,
            10,
          ),
          includesCleaning(serviceName)
            ? await this.settings.getNumber(SETTING_KEYS.COOK_CLEANING_MONTHLY, 1200)
            : 0,
          durationDays,
          /both/i.test(tier.label),
        )
      : null;
    const subtotal = cook ? cook.gross : round2(Number(tier.price));
    const discount = cook ? cook.discount : 0;
    const taxPercent = await this.settings.getNumber(
      SETTING_KEYS.BOOKING_TAX_PERCENT,
      0,
    );
    const tax = round2(((subtotal - discount) * taxPercent) / 100);
    const totalAmount = round2(subtotal - discount + tax);

    const serviceArea = await this.resolveAddressZone(address);

    const peopleLabel = cook
      ? ` · ${cook.count} ${cook.count === 1 ? 'person' : 'people'}`
      : '';
    const serviceDays = durationDays === 28 ? 30 : durationDays;
    const packLabel =
      durationDays <= 3
        ? 'Trial pack'
        : durationDays === 28
          ? '28 days + 2 free'
          : `${durationDays} days`;
    const planTitle = cookService
      ? `${serviceName} · ${packLabel} · ${tier.label}${peopleLabel}`
      : planType === 'MONTHLY'
        ? `${serviceName} · ${tier.label}${peopleLabel} (monthly)`
        : `${serviceName} · ${tier.label}`;

    const booking = await this.bookingRepo.save(
      this.bookingRepo.create({
        bookingNumber: await this.generateBookingNumber(),
        customerId,
        addressId: address.id,
        serviceAreaId: serviceArea?.id ?? null,
        bookingDate,
        startTime,
        bookingMode,
        durationMinutes: cookService ? 45 : tier.minutes ?? 240,
        subtotal: subtotal.toFixed(2),
        discount: discount.toFixed(2),
        tax: tax.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        paymentStatus: totalAmount <= 0 ? 'PAID' : 'PENDING',
        status: 'finding',
        startOtp: String(randomInt(1000, 10000)),
        notes: [dto.notes, cookService ? `Service runs for ${serviceDays} days.` : '']
          .filter(Boolean)
          .join(' · ') || null,
        planType,
        planTitle,
        homeCategoryId: category.id,
        homeOptionId: option?.id ?? null,
      }),
    );

    await this.paymentRepo.save(
      this.paymentRepo.create({
        bookingId: booking.id,
        customerId,
        amount: totalAmount.toFixed(2),
        paymentStatus: totalAmount <= 0 ? 'PAID' : 'PENDING',
        ...(totalAmount <= 0 ? { paidAt: new Date() } : {}),
      }),
    );

    await this.attachVisits(booking);

    if (totalAmount <= 0) {
      await this.history.transition(booking, 'paid', userId, 'Free booking is open for agents');
      await this.dispatch.kick(booking.id);
    }

    await this.history.record(
      booking.id,
      booking.status,
      userId,
      `Plan booked by customer: ${planTitle}`,
    );

    return this.detail(userId, booking.id);
  }

  async createBeauty(userId: string, dto: CreateBeautyBookingDto) {
    const service = findBeautyService(dto.serviceId);
    if (!service) throw new NotFoundException('This service is unavailable');

    const customerId = await this.identity.requireCustomerId(userId);
    await this.assertNoDues(customerId);
    const address = await this.addressRepo.findOne({
      where: { id: dto.addressId, customerId },
    });
    if (!address) throw new NotFoundException('Address not found');

    const { bookingDate, startTime, bookingMode } = scheduledSlot(dto.bookingDate, dto.startTime);
    const subtotal = round2(service.price);
    const taxPercent = await this.settings.getNumber(SETTING_KEYS.BOOKING_TAX_PERCENT, 0);
    const tax = round2((subtotal * taxPercent) / 100);
    const totalAmount = round2(subtotal + tax);
    const serviceArea = await this.resolveAddressZone(address);

    const booking = await this.bookingRepo.save(
      this.bookingRepo.create({
        bookingNumber: await this.generateBookingNumber(),
        customerId,
        addressId: address.id,
        serviceAreaId: serviceArea?.id ?? null,
        bookingDate,
        startTime,
        bookingMode,
        durationMinutes: service.minutes,
        subtotal: subtotal.toFixed(2),
        discount: '0.00',
        tax: tax.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        paymentStatus: 'PENDING',
        status: 'finding',
        startOtp: String(randomInt(1000, 10000)),
        notes: [service.includes.join(', '), dto.notes].filter(Boolean).join(' · ') || null,
        planType: 'HOURLY',
        planTitle: service.title,
        homeCategoryId: null,
        homeOptionId: null,
      }),
    );

    await this.paymentRepo.save(
      this.paymentRepo.create({
        bookingId: booking.id,
        customerId,
        amount: totalAmount.toFixed(2),
        paymentStatus: 'PENDING',
      }),
    );

    await this.attachVisits(booking);
    await this.history.record(
      booking.id,
      booking.status,
      userId,
      `Beauty booked by customer: ${service.title}`,
    );

    return this.detail(userId, booking.id);
  }

  async cookTrialUsed(userId: string) {
    const customerId = await this.identity.requireCustomerId(userId);
    return { used: await this.customerUsedCookTrial(customerId) };
  }

  private async attachVisits(booking: Booking) {
    const existing = await this.visitRepo.count({ where: { bookingId: booking.id } });
    if (existing) return;
    const plan = buildVisitPlan(booking);
    const firstOtp = booking.startOtp ?? freshOtp();
    const done = booking.status === 'completed';
    const rows = plan.map((visit, index) =>
      this.visitRepo.create({
        bookingId: booking.id,
        visitDate: visit.visitDate,
        shift: visit.shift,
        startTime: visit.startTime,
        otp: index === 0 ? firstOtp : freshOtp(),
        status: done ? 'done' : booking.status === 'ongoing' && index === 0 ? 'active' : 'pending',
        completedAt: done ? new Date() : null,
      }),
    );
    if (!rows.length) return;
    await this.visitRepo.save(rows);
    if (booking.startOtp !== rows[0].otp) {
      booking.startOtp = rows[0].otp;
      await this.bookingRepo.save(booking);
    }
  }

  private async visitsFor(bookings: Booking[]) {
    const grouped = new Map<string, ReturnType<CustomerBookingsService['presentVisit']>[]>();
    if (!bookings.length) return grouped;
    await Promise.all(bookings.map((booking) => this.attachVisits(booking)));
    const rows = await this.visitRepo.find({
      where: { bookingId: In(bookings.map((booking) => booking.id)) },
      order: { visitDate: 'ASC', startTime: 'ASC' },
    });
    for (const row of rows) {
      const list = grouped.get(row.bookingId) ?? [];
      list.push(this.presentVisit(row));
      grouped.set(row.bookingId, list);
    }
    return grouped;
  }

  private presentVisit(visit: BookingVisit) {
    return {
      id: visit.id,
      visitDate: String(visit.visitDate).slice(0, 10),
      shift: visit.shift,
      startTime: visit.startTime,
      otp: visit.otp,
      status: visit.status,
    };
  }

  private async customerUsedCookTrial(customerId: string) {
    const count = await this.bookingRepo
      .createQueryBuilder('booking')
      .where('booking.customerId = :customerId', { customerId })
      .andWhere('booking.status != :cancelled', { cancelled: 'cancelled' })
      .andWhere('booking.planTitle ILIKE :trial', { trial: '%Trial pack%' })
      .andWhere('booking.planTitle ILIKE :cook', { cook: '%cook%' })
      .getCount();
    return count > 0;
  }

  async list(userId: string, query: ListCustomerBookingsQueryDto) {
    const customerId = await this.identity.requireCustomerId(userId);
    // The home screen polls this while a job is live; it also keeps dispatch
    // moving (waves, "Right now" expiry) where no timer runs.
    await this.dispatch.tickFromRequest();

    // Only confirmed bookings: an unpaid request ('finding', or voided once it
    // timed out or was dropped) never became one.
    if (query.status === 'finding') return paginated([], 0, query);
    const [bookings, total] = await this.bookingRepo.findAndCount({
      where: {
        customerId,
        status: query.status ?? Not('finding'),
        paymentStatus: Not('VOIDED'),
        ...dateRangeWhere(query.from, query.to),
      },
      relations: ['items', 'items.service', 'agent', 'address'],
      order: { bookingDate: 'DESC', startTime: 'DESC', createdAt: 'DESC' },
      ...skipTake(query),
    });

    const visitsByBooking = await this.visitsFor(bookings);
    const ratedRows = bookings.length
      ? await this.ratingRepo.find({
          where: { bookingId: In(bookings.map((booking) => booking.id)) },
          select: ['id', 'bookingId'],
        })
      : [];
    const ratedIds = new Set(ratedRows.map((row) => row.bookingId));
    const refunds = await this.wallet.refundsFor(bookings.map((booking) => booking.id));

    const items = bookings.map((booking) => ({
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      totalAmount: Number(booking.totalAmount),
      durationMinutes: booking.durationMinutes,
      planType: booking.planType,
      planTitle: booking.planTitle,
      startOtp: booking.startOtp,
      visits: visitsByBooking.get(booking.id) ?? [],
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
      rated: ratedIds.has(booking.id),
      paymentMode: booking.paymentMode,
      refundedToWallet: refunds.get(booking.id) ?? 0,
      address: booking.address
        ? [booking.address.addressLine1, booking.address.city]
            .filter(Boolean)
            .join(', ')
        : null,
      services: booking.items?.length
        ? booking.items.map((item) => item.service?.name ?? '')
        : booking.planTitle
          ? [booking.planTitle]
          : [],
      agent: booking.agent
        ? {
            agentId: booking.agent.id,
            name: agentName(booking.agent.firstName, booking.agent.lastName),
            profileImage: booking.agent.profileImage,
          }
        : null,
    }));

    return paginated(items, total, query);
  }

  async detail(userId: string, id: string) {
    const customerId = await this.identity.requireCustomerId(userId);
    const booking = await this.findOwn(customerId, id, DETAIL_RELATIONS);
    const statusHistory = await this.history.history(booking.id);
    const rating = (booking.ratings ?? [])[0] ?? null;
    const refunds = await this.wallet.refundsFor([booking.id]);

    return {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      paymentMode: booking.paymentMode,
      refundedToWallet: refunds.get(booking.id) ?? 0,
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      durationMinutes: booking.durationMinutes,
      subtotal: Number(booking.subtotal),
      discount: Number(booking.discount),
      tax: Number(booking.tax),
      totalAmount: Number(booking.totalAmount),
      notes: booking.notes,
      planType: booking.planType,
      planTitle: booking.planTitle,
      // Handed to the agent on arrival to start the job.
      startOtp: booking.startOtp,
      visits: (await this.visitsFor([booking])).get(booking.id) ?? [],
      serviceAreaId: booking.serviceAreaId,
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
      address: booking.address
        ? {
            id: booking.address.id,
            addressLine1: booking.address.addressLine1,
            addressLine2: booking.address.addressLine2,
            landmark: booking.address.landmark,
            city: booking.address.city,
            state: booking.address.state,
            pincode: booking.address.pincode,
            latitude: toNumberOrNull(booking.address.latitude),
            longitude: toNumberOrNull(booking.address.longitude),
            addressType: booking.address.addressType,
          }
        : null,
      payment: booking.payment
        ? {
            id: booking.payment.id,
            amount: Number(booking.payment.amount),
            paymentStatus: booking.payment.paymentStatus,
            paymentMethod: booking.payment.paymentMethod,
            paidAt: booking.payment.paidAt,
          }
        : null,
      agent: booking.agent
        ? {
            agentId: booking.agent.id,
            name: agentName(booking.agent.firstName, booking.agent.lastName),
            profileImage: booking.agent.profileImage,
            mobile: booking.agent.user?.mobile ?? null,
          }
        : null,
      statusHistory: statusHistory.map((row) => ({
        status: row.status,
        remarks: row.remarks,
        createdAt: row.createdAt,
      })),
      rating: rating
        ? {
            id: rating.id,
            rating: Number(rating.rating),
            review: (rating.reviews ?? [])[0]?.reviewText ?? null,
            createdAt: rating.createdAt,
          }
        : null,
      createdAt: booking.createdAt,
    };
  }

  async requestCookChange(userId: string, id: string) {
    const customerId = await this.identity.requireCustomerId(userId);
    const booking = await this.findOwn(customerId, id, ['agent']);
    if (booking.planType !== 'MONTHLY') {
      throw new BadRequestException('Cook changes are for monthly plans');
    }
    if (!booking.agentId || !booking.agent) {
      throw new BadRequestException('A cook has not been assigned yet');
    }
    if (booking.status === 'completed' || booking.status === 'cancelled') {
      throw new BadRequestException('This booking is already closed');
    }

    const existing = await this.ticketRepo.findOne({
      where: {
        userId,
        bookingId: booking.id,
        status: 'OPEN',
        subject: Like('Change cook%'),
      },
    });
    if (existing) return { id: existing.id, alreadyRequested: true };

    const cook = agentName(booking.agent.firstName, booking.agent.lastName);
    const ticket = await this.ticketRepo.save(
      this.ticketRepo.create({
        userId,
        bookingId: booking.id,
        subject: `Change cook · ${booking.bookingNumber}`,
        description: `Customer asked to change the cook on monthly booking ${booking.bookingNumber}. Current cook: ${cook}.`,
        priority: 'HIGH',
        status: 'OPEN',
      }),
    );
    return { id: ticket.id, alreadyRequested: false };
  }

  async cancel(userId: string, id: string, dto: CancelCustomerBookingDto) {
    const customerId = await this.identity.requireCustomerId(userId);
    const booking = await this.findOwn(customerId, id, ['agent']);

    // One transaction: status, payment (REFUNDED to the wallet, or VOIDED) and history.
    const closed = await this.closure.close(booking.id, 'cancelled', {
      reason: 'BOOKING_CANCELLED',
      changedBy: userId,
      remarks: dto.reason ? `Cancelled by customer: ${dto.reason}` : 'Cancelled by customer',
      onlyIf: (locked) => {
        if (locked.planType === 'MONTHLY' && locked.agentId) {
          throw new BadRequestException(
            'A cook is already assigned. Ask to change cook instead of cancelling.',
          );
        }
        return true;
      },
    });
    if (!closed) throw new NotFoundException('Booking not found');
    const { refundedToWallet, releasedCoupons } = closed;

    if (refundedToWallet > 0) {
      await this.notifications
        .toUser(userId, {
          title: 'Refund added to your wallet',
          message: `Booking ${booking.bookingNumber} was cancelled. ₹${refundedToWallet} has been added to your wallet.${couponNote(releasedCoupons)}`,
          type: 'wallet_refund',
          data: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
        })
        .catch(() => undefined);
    }

    if (booking.agent && booking.agent.id === closed.booking.agentId) {
      await this.notifications.toUser(booking.agent.userId, {
        title: 'Booking cancelled',
        message: `Booking ${booking.bookingNumber} was cancelled by the customer.`,
        type: 'booking',
        data: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
      });
    }

    return {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      status: closed.booking.status,
      paymentStatus: closed.paymentStatus,
      refundedToWallet,
      releasedCoupons,
      cancelledReason: dto.reason ?? null,
    };
  }

  /**
   * Online payment failed MAX_PAYMENT_ATTEMPTS times: confirm the booking
   * anyway, to be paid by the end of the job (in the app, or by scanning the
   * agent's QR). Single visits up to PAY_AFTER_SERVICE_MAX_AMOUNT only; plans
   * stay prepaid.
   */
  async payAfterService(userId: string, id: string) {
    const customerId = await this.identity.requireCustomerId(userId);
    await this.findOwn(customerId, id);

    const booking = await this.bookingRepo.manager.transaction(async (manager) => {
      const locked = await manager.findOneOrFail(Booking, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (locked.status !== 'finding') {
        throw new BadRequestException('Only a booking waiting for payment can switch to pay after service');
      }
      if (locked.planType === 'MONTHLY') {
        throw new BadRequestException('Monthly plans are paid upfront');
      }
      if (Number(locked.totalAmount) > PAY_AFTER_SERVICE_MAX_AMOUNT) {
        throw new BadRequestException(
          `Pay after service is only for bookings up to ₹${PAY_AFTER_SERVICE_MAX_AMOUNT}`,
        );
      }
      if (Date.now() - locked.createdAt.getTime() > PAYMENT_WINDOW_MINUTES * 60_000) {
        throw new BadRequestException('This booking request has timed out. Please book again.');
      }
      const start = new Date(`${String(locked.bookingDate).slice(0, 10)}T${locked.startTime}`).getTime();
      if (start <= Date.now()) {
        throw new BadRequestException('This slot has passed. Please book again.');
      }
      const payment = await manager.findOne(Payment, { where: { bookingId: id } });
      // Offered only once the online attempts are used up (one order each).
      const attempts = payment
        ? await manager.count(PaymentTransaction, { where: { paymentId: payment.id, status: 'created' } })
        : 0;
      if (attempts < MAX_PAYMENT_ATTEMPTS) {
        throw new BadRequestException(
          `Pay after service is offered after ${MAX_PAYMENT_ATTEMPTS} failed online payments`,
        );
      }

      if (payment && payment.paymentStatus !== 'PENDING') {
        await manager.update(Payment, { id: payment.id }, { paymentStatus: 'PENDING' });
      }
      await manager.update(
        Booking,
        { id },
        { status: 'paid', paymentMode: 'AFTER_SERVICE', paymentStatus: 'PENDING' },
      );
      await manager.save(
        manager.create(BookingStatusHistory, {
          bookingId: id,
          status: 'paid',
          changedBy: userId,
          remarks: 'Confirmed: the customer pays after the service',
        }),
      );
      return { ...locked, status: 'paid' as const, paymentMode: 'AFTER_SERVICE' as const, paymentStatus: 'PENDING' };
    });

    await this.dispatch.kick(id);
    return {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      paymentMode: booking.paymentMode,
      paymentStatus: booking.paymentStatus,
      totalAmount: Number(booking.totalAmount),
    };
  }

  async reschedule(
    userId: string,
    id: string,
    dto: RescheduleCustomerBookingDto,
  ) {
    const customerId = await this.identity.requireCustomerId(userId);
    const booking = await this.findOwn(customerId, id, ['agent']);

    if (!RESCHEDULABLE.includes(booking.status)) {
      throw new BadRequestException(
        `A ${booking.status} booking cannot be rescheduled`,
      );
    }

    const startTime = toTimeString(dto.startTime);
    if (istInstant(dto.bookingDate, startTime).getTime() <= Date.now()) {
      throw new BadRequestException('The new slot must be in the future');
    }

    const previous = `${booking.bookingDate} ${booking.startTime}`;
    booking.bookingDate = dto.bookingDate;
    booking.startTime = startTime;
    // A picked slot, so no longer a "Right now" job on the 10-minute search clock.
    booking.bookingMode = 'SCHEDULED';
    await this.bookingRepo.save(booking);

    const remarks = `Rescheduled from ${previous} to ${dto.bookingDate} ${startTime}${
      dto.reason ? ` (${dto.reason})` : ''
    }`;
    await this.history.record(booking.id, booking.status, userId, remarks);

    if (booking.status === 'paid' && !booking.agentId) {
      await this.dispatch.onRescheduled(booking.id);
    }

    // The assigned agent may not be able to make the new time: if it clashes
    // with their availability or other jobs, the job goes back to dispatch.
    let agentReleased = false;
    if (booking.agentId && RELEASABLE_STATUSES.includes(booking.status)) {
      const blocked = await this.eligibility.blockedJobs(booking.agentId, [booking]);
      if (blocked.has(booking.id)) {
        agentReleased = await this.dispatch.release(
          booking.id,
          "the new time clashes with the agent's schedule",
        );
        if (agentReleased) booking.status = 'paid';
      }
    }

    if (booking.agent && !agentReleased) {
      await this.notifications.toUser(booking.agent.userId, {
        title: 'Booking rescheduled',
        message: `Booking ${booking.bookingNumber} moved to ${dto.bookingDate} at ${startTime}.`,
        type: 'booking',
        data: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
      });
    }

    return {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      agentReleased,
    };
  }

  async agent(userId: string, id: string) {
    const customerId = await this.identity.requireCustomerId(userId);
    const booking = await this.findOwn(customerId, id, ['agent', 'agent.user']);
    if (!booking.agent) throw new NotFoundException('No agent assigned yet');

    const stats = await this.ratingRepo
      .createQueryBuilder('rating')
      .select('AVG(rating.rating)', 'average')
      .addSelect('COUNT(rating.id)', 'count')
      .where('rating.agent_id = :agentId', { agentId: booking.agent.id })
      .getRawOne<{ average: string | null; count: string }>();

    const average = stats?.average ? Number(stats.average) : null;

    return {
      bookingId: booking.id,
      agentId: booking.agent.id,
      name: agentName(booking.agent.firstName, booking.agent.lastName),
      profileImage: booking.agent.profileImage,
      mobile: booking.agent.user?.mobile ?? null,
      averageRating: average === null ? null : round2(average),
      ratingCount: Number(stats?.count ?? 0),
    };
  }

  private async resolveAddressZone(address: CustomerAddress) {
    if (address.serviceAreaId) {
      const existing = await this.serviceAreaRepo.findOne({
        where: { id: address.serviceAreaId, isActive: true },
      });
      if (existing) return existing;
    }
    const zone = await this.zones.resolve({
      pincode: address.pincode,
      latitude: address.latitude == null ? null : Number(address.latitude),
      longitude: address.longitude == null ? null : Number(address.longitude),
      city: address.city,
    });
    if (zone && address.serviceAreaId !== zone.id) {
      address.serviceAreaId = zone.id;
      await this.addressRepo.save(address);
    }
    // Neither a zone nor a map pin: no agent could ever be matched to it.
    if (!zone && (address.latitude == null || address.longitude == null)) {
      const soon = await this.serviceability.comingSoon({ city: address.city });
      throw new BadRequestException(
        `${soon.message} Drop a pin on the map or choose an address in a service area.`,
      );
    }
    return zone;
  }

  /**
   * Any completed booking left unpaid blocks new bookings until that booking
   * is paid, whatever else is in the wallet (refunds don't pay it off).
   */
  private async assertNoDues(customerId: string) {
    const dues = await this.wallet.outstandingDues(customerId);
    if (!dues.length) return;
    const owed = dues.reduce((sum, due) => sum + due.amount, 0);
    const from = dues[0].bookingNumber ? ` from booking ${dues[0].bookingNumber}` : '';
    throw new ConflictException(
      `You have ₹${owed} due${from}. Please pay it before making a new booking.`,
    );
  }

  private async findOwn(
    customerId: string,
    id: string,
    relations: string[] = [],
  ) {
    const booking = await this.bookingRepo.findOne({
      where: { id, customerId },
      relations,
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** Resolves every line to an active service and a usable price. */
  private async priceItems(
    dto: CreateCustomerBookingDto,
    serviceAreaId: string | null,
  ): Promise<PricedItem[]> {
    const serviceIds = [...new Set(dto.items.map((item) => item.serviceId))];
    const services = await this.serviceRepo.find({
      where: { id: In(serviceIds), isActive: true },
    });
    if (services.length !== serviceIds.length) {
      throw new BadRequestException(
        'One or more of the selected services is unavailable',
      );
    }
    const byId = new Map(services.map((service) => [service.id, service]));

    const pricing = await this.pricingRepo.find({
      where: { serviceId: In(serviceIds), isActive: true },
    });

    return dto.items.map((item) => {
      const service = byId.get(item.serviceId) as Service;
      const rows = pricing.filter((row) => row.serviceId === service.id);
      const price =
        (serviceAreaId
          ? rows.find((row) => row.serviceAreaId === serviceAreaId)
          : undefined) ?? rows.find((row) => row.serviceAreaId === null);
      if (!price) {
        throw new BadRequestException(
          `No price is configured for ${service.name}`,
        );
      }

      const quantity = item.quantity ?? 1;
      const durationMinutes = item.durationMinutes ?? service.durationMinutes;
      const pricePerHour = Number(price.pricePerHour);

      return {
        service,
        quantity,
        durationMinutes,
        pricePerHour,
        amount: round2((pricePerHour * durationMinutes * quantity) / 60),
      };
    });
  }

  /** Validates a coupon against the subtotal and returns the discount. */
  private async resolveCoupon(code: string, subtotal: number) {
    const coupon = await this.couponRepo.findOne({
      where: { code: code.trim().toUpperCase() },
    });
    if (!coupon || !coupon.isActive) {
      throw new BadRequestException('This coupon code is not valid');
    }

    const now = new Date();
    if (coupon.validFrom && coupon.validFrom > now) {
      throw new BadRequestException('This coupon is not active yet');
    }
    if (coupon.validUntil && coupon.validUntil < now) {
      throw new BadRequestException('This coupon has expired');
    }
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException('This coupon has reached its usage limit');
    }

    const minOrderAmount = Number(coupon.minOrderAmount ?? 0);
    if (subtotal < minOrderAmount) {
      throw new BadRequestException(
        `This coupon needs a minimum order of ${minOrderAmount.toFixed(2)}`,
      );
    }

    const value = Number(coupon.discountValue);
    let discount =
      coupon.discountType.toUpperCase() === 'PERCENT'
        ? (subtotal * value) / 100
        : value;
    if (coupon.maxDiscount !== null) {
      discount = Math.min(discount, Number(coupon.maxDiscount));
    }

    return { coupon, discount: round2(Math.min(discount, subtotal)) };
  }

  /** Per-person cook rate for the chosen shift. One shift is morning or evening; both is its own rate. */
  private async cookRate(label: string) {
    const value = label.toLowerCase();
    if (value.includes('both')) {
      return this.settings.getNumber(SETTING_KEYS.COOK_BOTH_PER_PERSON, 2000);
    }
    if (value.includes('evening')) {
      return this.settings.getNumber(SETTING_KEYS.COOK_EVENING_PER_PERSON, 1200);
    }
    return this.settings.getNumber(SETTING_KEYS.COOK_MORNING_PER_PERSON, 1200);
  }

  /** `CL` + yymmdd + 5 random digits, retried until it is unique. */
  private async generateBookingNumber() {
    const now = new Date();
    const stamp = toDateString(now).slice(2).replace(/-/g, '');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const bookingNumber = `CL${stamp}${String(randomInt(0, 100000)).padStart(5, '0')}`;
      const taken = await this.bookingRepo.findOne({
        where: { bookingNumber },
        select: ['id'],
      });
      if (!taken) return bookingNumber;
    }

    throw new ConflictException(
      'Could not allocate a booking number, please retry',
    );
  }
}

/** Cook plans, including Cook + Cleaning, are priced per person. */
function isCookService(title: string) {
  return /\bcook\b/i.test(title);
}

function includesCleaning(title: string) {
  return /clean/i.test(title);
}

const COOK_PACK_PRICE: Record<number, number> = {
  3: 0,
  7: 600,
  14: 1100,
  21: 1600,
  28: 2200,
};

const COOK_ONE_TIME_OFF: Record<number, number> = {
  3: 0,
  7: 200,
  14: 400,
  21: 600,
  28: 800,
};

function cookPackRate(days: number, both: boolean) {
  const bothPrice = COOK_PACK_PRICE[days] ?? COOK_PACK_PRICE[28];
  if (both || bothPrice === 0) return bothPrice;
  return Math.max(0, bothPrice - (COOK_ONE_TIME_OFF[days] ?? 0));
}

/** First person pays the pack price. Each extra person is discounted. Cleaning scales with the paid days. */
function cookCharge(
  people: number,
  _perPerson: number,
  discountPercent: number,
  cleaningMonthly: number,
  days = 28,
  both = true,
) {
  const count = Math.min(12, Math.max(1, Math.floor(people)));
  const rate = cookPackRate(days, both);
  const percent = Math.min(100, Math.max(0, discountPercent));
  const factor = days / 28;
  // Cleaning is charged per visit, so morning + evening is twice the cleaning.
  const visitsPerDay = both ? 2 : 1;
  const cleaning =
    rate === 0 ? 0 : round2(Math.max(0, cleaningMonthly) * factor * visitsPerDay);
  const cooking = round2(rate * count);
  const discount = round2(((count - 1) * rate * percent) / 100);
  const gross = round2(cooking + cleaning);
  return {
    count,
    rate,
    percent,
    cooking,
    cleaning,
    gross,
    discount,
    net: round2(gross - discount),
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function toNumberOrNull(value: string | null) {
  return value === null ? null : Number(value);
}

/** Customers book in India time; the server clock may be UTC. */
const IST_OFFSET_MINUTES = 330;

function toIst(date: Date) {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
}

function toDateString(date: Date) {
  const ist = toIst(date);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

/** A wall-clock date + time in India as an absolute instant. */
function istInstant(date: string, time: string) {
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+05:30`);
}

function istMinutesOfDay(date: Date) {
  const ist = toIst(date);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** On-demand visits run 8 AM – 8:30 PM; "Right now" opens 15 minutes early. */
const SERVICE_OPEN_MINUTES = 8 * 60;
const SERVICE_LAST_SLOT_MINUTES = 20 * 60 + 30;
const INSTANT_CUTOFF_MINUTES = SERVICE_LAST_SLOT_MINUTES;
const INSTANT_OPEN_MINUTES = SERVICE_OPEN_MINUTES - 15;

/** `time` columns are stored as 'HH:MM:SS'. */
function toTimeString(value: string) {
  return value.length === 5 ? `${value}:00` : value;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Now + 15 minutes in India time, rounded up to the next 5 minutes. */
function instantSlot() {
  const now = new Date();
  const minutes = istMinutesOfDay(now);
  if (minutes < INSTANT_OPEN_MINUTES || minutes > INSTANT_CUTOFF_MINUTES) {
    throw new BadRequestException(
      'Right now bookings are available from 8 AM to 8:30 PM. Please schedule a slot instead.',
    );
  }
  const slot = toIst(new Date(now.getTime() + 15 * 60_000));
  slot.setUTCSeconds(0, 0);
  slot.setUTCMinutes(Math.ceil(slot.getUTCMinutes() / 5) * 5);
  const pad = (part: number) => String(part).padStart(2, '0');
  return {
    bookingDate: `${slot.getUTCFullYear()}-${pad(slot.getUTCMonth() + 1)}-${pad(slot.getUTCDate())}`,
    startTime: `${pad(slot.getUTCHours())}:${pad(slot.getUTCMinutes())}:00`,
    bookingMode: 'INSTANT' as const,
  };
}

const MAX_ADVANCE_DAYS = 30;

/** A customer-picked India-time slot within service hours, otherwise the instant slot. */
function scheduledSlot(date?: string, time?: string) {
  if (!date || !time) return instantSlot();
  const slot = istInstant(date, time);
  if (Number.isNaN(slot.getTime())) {
    throw new BadRequestException('Please choose a valid date and time');
  }
  const [hour, minute] = time.split(':').map(Number);
  const slotMinutes = hour * 60 + minute;
  if (slotMinutes < SERVICE_OPEN_MINUTES - 15 || slotMinutes > SERVICE_LAST_SLOT_MINUTES + 15) {
    throw new BadRequestException('Please pick a time between 8 AM and 8:30 PM');
  }
  if (slot.getTime() < Date.now() + 10 * 60_000) {
    throw new BadRequestException('That time has passed. Please pick a later slot.');
  }
  if (slot.getTime() > addDays(new Date(), MAX_ADVANCE_DAYS).getTime()) {
    throw new BadRequestException(`You can book up to ${MAX_ADVANCE_DAYS} days ahead`);
  }
  return {
    bookingDate: date,
    startTime: time.length === 5 ? `${time}:00` : time,
    bookingMode: 'SCHEDULED' as const,
  };
}

/** Monthly plans start tomorrow at the earliest. */
function planStartDate(date?: string) {
  const tomorrow = toDateString(addDays(new Date(), 1));
  if (!date) return tomorrow;
  if (date < tomorrow) {
    throw new BadRequestException('Monthly plans can start from tomorrow');
  }
  if (date > toDateString(addDays(new Date(), MAX_ADVANCE_DAYS))) {
    throw new BadRequestException(`Plans can start up to ${MAX_ADVANCE_DAYS} days ahead`);
  }
  return date;
}

function agentName(firstName: string, lastName: string | null) {
  return [firstName, lastName].filter(Boolean).join(' ').trim();
}

function dateRangeWhere(from?: string, to?: string) {
  if (from && to) return { bookingDate: Between(from, to) };
  if (from) return { bookingDate: MoreThanOrEqual(from) };
  if (to) return { bookingDate: LessThanOrEqual(to) };
  return {};
}
