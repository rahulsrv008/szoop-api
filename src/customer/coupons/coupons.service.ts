import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Coupon,
  CouponCustomer,
  CouponUsage,
  Customer,
} from 'src/database/entities';

import { CouponEligibilityService } from 'src/common/services/coupon-eligibility.service';

const round2 = (val: number) => Math.round(val * 100) / 100;

export type CustomerCouponItem = {
  id: string;
  code: string;
  description: string | null;
  discountType: 'PERCENT' | 'FLAT';
  discountValue: number;
  maxDiscount: number | null;
  minOrderAmount: number | null;
  validUntil: string | null;
  isAssigned: boolean;
  applicableServices: string[];
  eligibilityRuleName?: string | null;
};

export type ValidatedCouponResult = {
  valid: true;
  couponId: string;
  code: string;
  description: string | null;
  discountType: 'PERCENT' | 'FLAT';
  discountValue: number;
  discountAmount: number;
  subtotal: number;
  finalAmount: number;
};

@Injectable()
export class CustomerCouponsService {
  constructor(
    @InjectRepository(Coupon)
    private readonly couponRepo: Repository<Coupon>,
    @InjectRepository(CouponCustomer)
    private readonly couponCustomerRepo: Repository<CouponCustomer>,
    @InjectRepository(CouponUsage)
    private readonly couponUsageRepo: Repository<CouponUsage>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly eligibilityService: CouponEligibilityService,
  ) {}

  private async requireCustomer(userId: string): Promise<Customer> {
    const customer = await this.customerRepo.findOne({ where: { userId } });
    if (!customer) throw new NotFoundException('Customer profile not found');
    return customer;
  }

  /**
   * Returns all active coupons valid for this customer (public + explicitly assigned).
   * Dynamically filters based on saved coupon eligibility rules and service domain.
   */
  async listAvailable(
    userId: string,
    service?: 'CLEANING' | 'COOKING' | 'SALON',
  ): Promise<CustomerCouponItem[]> {
    const customer = await this.requireCustomer(userId);
    const now = new Date();

    // 1. Fetch all currently active coupons
    const qb = this.couponRepo
      .createQueryBuilder('coupon')
      .leftJoinAndSelect('coupon.assignedCustomers', 'assigned')
      .leftJoinAndSelect('coupon.eligibilityRule', 'eligibilityRule')
      .where('coupon.isActive = :active', { active: true })
      .andWhere(
        '(coupon.validFrom IS NULL OR coupon.validFrom <= :now)',
        { now },
      )
      .andWhere(
        '(coupon.validUntil IS NULL OR coupon.validUntil >= :now)',
        { now },
      )
      .andWhere(
        '(coupon.usageLimit IS NULL OR coupon.usedCount < coupon.usageLimit)',
      )
      .orderBy('coupon.createdAt', 'DESC');

    const allActive = await qb.getMany();

    // 2. Fetch all coupon IDs this customer has used
    const usages = await this.couponUsageRepo.find({
      where: { customerId: customer.id },
      select: ['couponId'],
    });
    const usageCounts = new Map<string, number>();
    for (const u of usages) {
      usageCounts.set(u.couponId, (usageCounts.get(u.couponId) ?? 0) + 1);
    }

    const result: CustomerCouponItem[] = [];

    for (const coupon of allActive) {
      const timesUsed = usageCounts.get(coupon.id) ?? 0;
      const perLimit = coupon.perCustomerLimit ?? 1;
      if (timesUsed >= perLimit) {
        // Customer already used their allowed redemptions (expired for this customer)
        continue;
      }

      const isDirect = coupon.customerId === customer.id;
      const isAssignedInList = coupon.assignedCustomers?.some(
        (ac) => ac.customerId === customer.id,
      );
      const hasRestrictions =
        Boolean(coupon.customerId) ||
        (coupon.assignedCustomers && coupon.assignedCustomers.length > 0);

      // If coupon is assigned to specific customers, user must be one of them
      if (hasRestrictions && !isDirect && !isAssignedInList) {
        continue;
      }

      // Check service applicability and dynamic eligibility rule
      if (service) {
        if (coupon.eligibilityRule) {
          const ruleCheck = await this.eligibilityService.evaluateRule(
            customer.id,
            coupon.eligibilityRule,
            service,
          );
          if (!ruleCheck.eligible) {
            continue;
          }
        } else {
          // Heuristic fallback for legacy coupons without explicit eligibility rule
          const upperCode = coupon.code.toUpperCase();
          if (service === 'COOKING' && (upperCode.startsWith('CLEAN') || upperCode.startsWith('SALON'))) {
            continue;
          }
          if (service === 'CLEANING' && (upperCode.startsWith('COOK') || upperCode.startsWith('SALON'))) {
            continue;
          }
          if (service === 'SALON' && (upperCode.startsWith('CLEAN') || upperCode.startsWith('COOK'))) {
            continue;
          }
        }
      } else if (coupon.eligibilityRule) {
        const ruleCheck = await this.eligibilityService.evaluateRule(
          customer.id,
          coupon.eligibilityRule,
        );
        if (!ruleCheck.eligible) {
          continue;
        }
      }

      result.push({
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discountType.toUpperCase() as 'PERCENT' | 'FLAT',
        discountValue: Number(coupon.discountValue),
        maxDiscount: coupon.maxDiscount ? Number(coupon.maxDiscount) : null,
        minOrderAmount: coupon.minOrderAmount
          ? Number(coupon.minOrderAmount)
          : null,
        validUntil: coupon.validUntil ? coupon.validUntil.toISOString() : null,
        isAssigned: isDirect || Boolean(isAssignedInList),
        applicableServices: coupon.eligibilityRule?.applicableServices ?? ['ALL'],
        eligibilityRuleName: coupon.eligibilityRule?.name ?? null,
      });
    }

    return result;
  }

  /**
   * Validates a coupon code against a subtotal for the logged-in customer.
   */
  async validate(
    userId: string,
    rawCode: string,
    subtotal: number,
    rawService?: string,
  ): Promise<ValidatedCouponResult> {
    const customer = await this.requireCustomer(userId);
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) throw new BadRequestException('Coupon code is required');
    const service = rawService
      ? (rawService.toUpperCase().trim() as 'CLEANING' | 'COOKING' | 'SALON')
      : undefined;

    const coupon = await this.couponRepo.findOne({
      where: { code },
      relations: ['assignedCustomers', 'eligibilityRule'],
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

    // Check dynamic eligibility rule or service specificity
    if (service) {
      if (coupon.eligibilityRule) {
        const ruleCheck = await this.eligibilityService.evaluateRule(
          customer.id,
          coupon.eligibilityRule,
          service,
        );
        if (!ruleCheck.eligible) {
          throw new BadRequestException(
            ruleCheck.reason || `This coupon is not valid for ${service} services`,
          );
        }
      } else {
        const upperCode = coupon.code.toUpperCase();
        if (service === 'COOKING' && (upperCode.startsWith('CLEAN') || upperCode.startsWith('SALON'))) {
          throw new BadRequestException('This coupon is only valid for Cleaning services');
        }
        if (service === 'CLEANING' && (upperCode.startsWith('COOK') || upperCode.startsWith('SALON'))) {
          throw new BadRequestException('This coupon is only valid for Cooking services');
        }
        if (service === 'SALON' && (upperCode.startsWith('CLEAN') || upperCode.startsWith('COOK'))) {
          throw new BadRequestException('This coupon is not valid for Salon services');
        }
      }
    } else if (coupon.eligibilityRule) {
      const ruleCheck = await this.eligibilityService.evaluateRule(
        customer.id,
        coupon.eligibilityRule,
      );
      if (!ruleCheck.eligible) {
        throw new BadRequestException(
          ruleCheck.reason || 'You are not eligible for this coupon',
        );
      }
    }

    // Check customer-specific assignment
    const isDirect = coupon.customerId === customer.id;
    const isAssignedInList = coupon.assignedCustomers?.some(
      (ac) => ac.customerId === customer.id,
    );
    const hasRestrictions =
      Boolean(coupon.customerId) ||
      (coupon.assignedCustomers && coupon.assignedCustomers.length > 0);

    if (hasRestrictions && !isDirect && !isAssignedInList) {
      throw new BadRequestException('This coupon is not valid for your account');
    }

    // Check per-customer usage limit
    const usedCountByCustomer = await this.couponUsageRepo.count({
      where: { couponId: coupon.id, customerId: customer.id },
    });
    const perLimit = coupon.perCustomerLimit ?? 1;
    if (usedCountByCustomer >= perLimit) {
      throw new BadRequestException(
        'You have already redeemed this coupon',
      );
    }

    // Check minimum order amount
    const minOrderAmount = Number(coupon.minOrderAmount ?? 0);
    if (subtotal < minOrderAmount) {
      throw new BadRequestException(
        `This coupon requires a minimum order of ₹${minOrderAmount.toFixed(0)}`,
      );
    }

    // Compute discount
    const value = Number(coupon.discountValue);
    let discount =
      coupon.discountType.toUpperCase() === 'PERCENT'
        ? (subtotal * value) / 100
        : value;

    if (coupon.maxDiscount !== null) {
      discount = Math.min(discount, Number(coupon.maxDiscount));
    }
    discount = round2(Math.min(discount, subtotal));
    const finalAmount = round2(Math.max(0, subtotal - discount));

    return {
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discountType.toUpperCase() as 'PERCENT' | 'FLAT',
      discountValue: value,
      discountAmount: discount,
      subtotal: round2(subtotal),
      finalAmount,
    };
  }
}
