import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Booking,
  CouponEligibilityRule,
  CouponRuleCondition,
  RuleComparisonOperator,
  RuleServiceType,
} from 'src/database/entities';
import { BEAUTY_SERVICES } from 'src/customer/bookings/beauty-catalog';

const BEAUTY_TITLE_SET = new Set(
  BEAUTY_SERVICES.map((s) => s.title.trim().toLowerCase()),
);

/**
 * Classifies any booking into one of the three primary service domains:
 * 'COOKING', 'SALON', or 'CLEANING'.
 */
export function classifyService(
  planTitle?: string | null,
): 'COOKING' | 'SALON' | 'CLEANING' {
  if (!planTitle) return 'CLEANING';
  const lower = planTitle.trim().toLowerCase();
  if (
    /\bcook\b|chef|meal|diet|dishes|utensil/i.test(lower) ||
    (/kitchen/i.test(lower) && !/clean/i.test(lower))
  ) {
    return 'COOKING';
  }
  if (
    BEAUTY_TITLE_SET.has(lower) ||
    /salon|beauty|facial|cleanup|wax|grooming|makeup|manicure|pedicure|hair|threading|eyebrow|bleach|detan/i.test(
      lower,
    )
  ) {
    return 'SALON';
  }
  return 'CLEANING';
}

function compare(
  actual: number,
  operator: RuleComparisonOperator | string,
  target: number,
): boolean {
  switch (operator) {
    case 'EQUALS':
    case '=':
    case '==':
      return actual === target;
    case 'GREATER_THAN':
    case '>':
      return actual > target;
    case 'GREATER_THAN_OR_EQUAL':
    case '>=':
      return actual >= target;
    case 'LESS_THAN':
    case '<':
      return actual < target;
    case 'LESS_THAN_OR_EQUAL':
    case '<=':
      return actual <= target;
    default:
      return actual >= target;
  }
}

export type EligibilityCheckResult = {
  eligible: boolean;
  reason?: string;
  ruleName?: string;
};

@Injectable()
export class CouponEligibilityService {
  private readonly logger = new Logger(CouponEligibilityService.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
  ) {}

  /**
   * Evaluates whether a customer meets the eligibility criteria of a given rule,
   * optionally within the context of a specific booking service type.
   */
  async evaluateRule(
    customerId: string,
    rule: CouponEligibilityRule | null | undefined,
    bookingService?: 'CLEANING' | 'COOKING' | 'SALON',
  ): Promise<EligibilityCheckResult> {
    // If no rule attached, or rule is inactive, it imposes no restrictions
    if (!rule || !rule.isActive) {
      return { eligible: true };
    }

    // 1. Service Applicability Check
    if (bookingService) {
      const targetService = bookingService.toUpperCase().trim();
      const applicable = (rule.applicableServices || ['ALL']).map((s) =>
        s.toUpperCase().trim(),
      );
      const matchesService =
        applicable.includes('ALL') || applicable.includes(targetService);
      if (!matchesService) {
        return {
          eligible: false,
          ruleName: rule.name,
          reason: `This coupon is only valid for ${applicable.join(', ')} services.`,
        };
      }
    }

    // 2. Fetch authoritative completed bookings for this customer
    // We only count 'completed' bookings; cancelled, failed, and unpaid are excluded.
    const completedBookings = await this.bookingRepo.find({
      where: { customerId, status: 'completed' },
      order: { createdAt: 'DESC' },
    });

    const conditions = rule.conditions || [];
    if (conditions.length === 0) {
      return { eligible: true, ruleName: rule.name };
    }

    const now = Date.now();
    const conditionResults: { passed: boolean; condition: CouponRuleCondition; detail: string }[] = [];

    for (const cond of conditions) {
      // Filter bookings matching the condition's target service
      let serviceBookings = completedBookings;
      if (cond.service && cond.service !== 'ALL') {
        serviceBookings = completedBookings.filter(
          (b) => classifyService(b.planTitle) === cond.service,
        );
      }

      // Filter by time window if specified
      if (cond.windowDays && cond.windowDays > 0) {
        const windowCutoff = new Date(now - cond.windowDays * 24 * 60 * 60 * 1000);
        serviceBookings = serviceBookings.filter(
          (b) => new Date(b.createdAt) >= windowCutoff,
        );
      }

      let passed = false;
      let detail = '';

      switch (cond.type) {
        case 'COMPLETED_BOOKINGS': {
          const count = serviceBookings.length;
          passed = compare(count, cond.operator, cond.value);
          detail = `Completed ${cond.service} bookings: actual ${count}, required ${cond.operator} ${cond.value}`;
          break;
        }

        case 'NEW_CUSTOMER': {
          const count = serviceBookings.length;
          passed = compare(count, cond.operator, cond.value);
          detail = `New customer check (${cond.service}): completed bookings ${count}, required ${cond.operator} ${cond.value}`;
          break;
        }

        case 'INACTIVE_DAYS':
        case 'DAYS_SINCE_SERVICE': {
          if (serviceBookings.length === 0) {
            // If customer has no completed bookings in this service, treat as fully inactive
            // (passes >= or > comparisons for days since last booking)
            passed = compare(999999, cond.operator, cond.value);
            detail = `No previous ${cond.service} bookings found (treated as inactive)`;
          } else {
            const lastBookingDate = new Date(serviceBookings[0].createdAt).getTime();
            const daysSince = Math.floor((now - lastBookingDate) / (24 * 60 * 60 * 1000));
            passed = compare(daysSince, cond.operator, cond.value);
            detail = `Days since last ${cond.service} booking: actual ${daysSince} days, required ${cond.operator} ${cond.value}`;
          }
          break;
        }

        default: {
          // Unknown condition type: default pass to avoid breaking
          passed = true;
          detail = `Unrecognized condition type: ${cond.type}`;
        }
      }

      conditionResults.push({ passed, condition: cond, detail });
    }

    const matchType = (rule.matchType || 'AND').toUpperCase();
    const isOverallEligible =
      matchType === 'OR'
        ? conditionResults.some((r) => r.passed)
        : conditionResults.every((r) => r.passed);

    if (!isOverallEligible) {
      const failed = conditionResults.filter((r) => !r.passed).map((r) => r.detail);
      const detailStr = failed.length ? ` (${failed.join('; ')})` : '';
      return {
        eligible: false,
        ruleName: rule.name,
        reason:
          rule.description ||
          `You do not meet the criteria for the "${rule.name}" coupon eligibility rule${detailStr}.`,
      };
    }

    return { eligible: true, ruleName: rule.name };
  }
}
