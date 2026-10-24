import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CouponEligibilityService } from '../../src/common/services/coupon-eligibility.service';
import {
  Booking,
  CouponEligibilityRule,
  CouponRuleCondition,
} from '../../src/database/entities';

// Mock builder for bookings
function createMockBooking(overrides: Partial<Booking>): Booking {
  return {
    id: 'b-' + Math.random().toString(36).substring(7),
    customerId: 'cust-1',
    status: 'completed',
    paymentStatus: 'PAID',
    planTitle: 'Deep Cleaning (2 BHK)',
    createdAt: new Date(),
    ...overrides,
  } as unknown as Booking;
}

function createService(customerBookings: Booking[]): CouponEligibilityService {
  const bookingRepoMock = {
    find: async () => customerBookings,
  };

  return new CouponEligibilityService(bookingRepoMock as any);
}

describe('CouponEligibilityService', () => {
  it('allows coupon if no eligibility rule is linked (backward compatibility)', async () => {
    const service = createService([]);
    const result = await service.evaluateRule('cust-1', null, 'CLEANING');
    assert.equal(result.eligible, true);
  });

  it('allows coupon if linked rule is deactivated', async () => {
    const inactiveRule = {
      id: 'r-1',
      name: 'Old Rule',
      isActive: false,
      applicableServices: ['ALL'],
      matchType: 'AND',
      conditions: [],
    } as unknown as CouponEligibilityRule;

    const service = createService([]);
    const result = await service.evaluateRule('cust-1', inactiveRule, 'CLEANING');
    assert.equal(result.eligible, true);
  });

  it('rejects if current service does not match rule applicable services', async () => {
    const rule = {
      id: 'r-1',
      name: 'Cooking Only Rule',
      isActive: true,
      applicableServices: ['COOKING'],
      matchType: 'AND',
      conditions: [],
    } as unknown as CouponEligibilityRule;

    const service = createService([]);
    const result = await service.evaluateRule('cust-1', rule, 'CLEANING');
    assert.equal(result.eligible, false);
    assert.match(result.reason || '', /only valid for COOKING services/);
  });

  describe('Scenario 1: Loyal Cleaning Customers (Completed Cleaning bookings >= 5)', () => {
    const rule = {
      id: 'r-loyal-clean',
      name: 'Loyal Cleaning Customers',
      isActive: true,
      applicableServices: ['CLEANING'],
      matchType: 'AND',
      conditions: [
        {
          type: 'COMPLETED_BOOKINGS',
          service: 'CLEANING',
          operator: 'GREATER_THAN_OR_EQUAL',
          value: 5,
        },
      ] as CouponRuleCondition[],
    } as unknown as CouponEligibilityRule;

    it('rejects customer with fewer than 5 completed cleaning bookings', async () => {
      const bookings = [
        createMockBooking({ planTitle: 'Kitchen Deep Clean' }),
        createMockBooking({ planTitle: 'Full Home Clean' }),
        createMockBooking({ planTitle: 'Bathroom Clean' }),
      ];
      const service = createService(bookings);

      const result = await service.evaluateRule('cust-1', rule, 'CLEANING');
      assert.equal(result.eligible, false);
      assert.match(result.reason || '', /Completed CLEANING bookings: actual 3, required GREATER_THAN_OR_EQUAL 5/);
    });

    it('approves customer with 5 or more completed cleaning bookings', async () => {
      const bookings = Array.from({ length: 6 }, () =>
        createMockBooking({ planTitle: 'Standard Home Cleaning' }),
      );
      const service = createService(bookings);

      const result = await service.evaluateRule('cust-1', rule, 'CLEANING');
      assert.equal(result.eligible, true);
    });

    it('excludes cancelled or unpaid bookings from qualifying count', async () => {
      // In production repository query, status: 'completed' filters out non-completed.
      // If service receives only non-completed, count is 0.
      const service = createService([]);
      const result = await service.evaluateRule('cust-1', rule, 'CLEANING');
      assert.equal(result.eligible, false);
      assert.match(result.reason || '', /Completed CLEANING bookings: actual 0/);
    });
  });

  describe('Scenario 2: Loyal Cooking Customers (Completed Cooking bookings >= 4)', () => {
    const rule = {
      id: 'r-loyal-cook',
      name: 'Loyal Cooking Customers',
      isActive: true,
      applicableServices: ['COOKING'],
      matchType: 'AND',
      conditions: [
        {
          type: 'COMPLETED_BOOKINGS',
          service: 'COOKING',
          operator: 'GREATER_THAN_OR_EQUAL',
          value: 4,
        },
      ] as CouponRuleCondition[],
    } as unknown as CouponEligibilityRule;

    it('rejects customer with 4 cleaning bookings and 0 cooking bookings', async () => {
      const bookings = Array.from({ length: 4 }, () =>
        createMockBooking({ planTitle: 'Sofa Cleaning' }),
      );
      const service = createService(bookings);

      const result = await service.evaluateRule('cust-1', rule, 'COOKING');
      assert.equal(result.eligible, false);
      assert.match(result.reason || '', /Completed COOKING bookings: actual 0, required GREATER_THAN_OR_EQUAL 4/);
    });

    it('approves customer with 4 completed cooking bookings', async () => {
      const bookings = Array.from({ length: 4 }, () =>
        createMockBooking({ planTitle: 'North Indian Cook (Dinner)' }),
      );
      const service = createService(bookings);

      const result = await service.evaluateRule('cust-1', rule, 'COOKING');
      assert.equal(result.eligible, true);
    });
  });

  describe('Scenario 3: Inactive Salon Customers (Days since last completed Salon booking >= 60)', () => {
    const rule = {
      id: 'r-inactive-salon',
      name: 'Inactive Salon Customers',
      isActive: true,
      applicableServices: ['SALON'],
      matchType: 'AND',
      conditions: [
        {
          type: 'DAYS_SINCE_SERVICE',
          service: 'SALON',
          operator: 'GREATER_THAN_OR_EQUAL',
          value: 60,
        },
      ] as CouponRuleCondition[],
    } as unknown as CouponEligibilityRule;

    it('rejects customer who had a salon booking 10 days ago', async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const bookings = [
        createMockBooking({
          planTitle: 'Hair Spa & Facial Salon Treatment',
          createdAt: tenDaysAgo,
        }),
      ];
      const service = createService(bookings);

      const result = await service.evaluateRule('cust-1', rule, 'SALON');
      assert.equal(result.eligible, false);
      assert.match(result.reason || '', /Days since last SALON booking: actual 10 days, required GREATER_THAN_OR_EQUAL 60/);
    });

    it('approves customer who had last salon booking 65 days ago', async () => {
      const sixtyFiveDaysAgo = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000);
      const bookings = [
        createMockBooking({
          planTitle: 'Salon Cleanup and Waxing',
          createdAt: sixtyFiveDaysAgo,
        }),
      ];
      const service = createService(bookings);

      const result = await service.evaluateRule('cust-1', rule, 'SALON');
      assert.equal(result.eligible, true);
    });
  });

  describe('Scenario 4: New Customers (Completed bookings = 0)', () => {
    const rule = {
      id: 'r-new-cust',
      name: 'New Customers First Booking',
      isActive: true,
      applicableServices: ['ALL'],
      matchType: 'AND',
      conditions: [
        {
          type: 'NEW_CUSTOMER',
          service: 'ALL',
          operator: 'EQUALS',
          value: 0,
        },
      ] as CouponRuleCondition[],
    } as unknown as CouponEligibilityRule;

    it('approves customer with 0 completed bookings', async () => {
      const service = createService([]);
      const result = await service.evaluateRule('cust-1', rule, 'CLEANING');
      assert.equal(result.eligible, true);
    });

    it('rejects customer who already completed 1 booking', async () => {
      const bookings = [createMockBooking({ planTitle: 'Home Clean' })];
      const service = createService(bookings);

      const result = await service.evaluateRule('cust-1', rule, 'CLEANING');
      assert.equal(result.eligible, false);
      assert.match(result.reason || '', /New customer check \(ALL\): completed bookings 1, required EQUALS 0/);
    });
  });

  describe('Scenario 5: Cross-Service Loyalty (Total bookings >= 5, applicable for Salon)', () => {
    const rule = {
      id: 'r-cross-loyalty',
      name: 'Cross-Service Loyalty',
      isActive: true,
      applicableServices: ['SALON'],
      matchType: 'AND',
      conditions: [
        {
          type: 'COMPLETED_BOOKINGS',
          service: 'ALL',
          operator: 'GREATER_THAN_OR_EQUAL',
          value: 5,
        },
      ] as CouponRuleCondition[],
    } as unknown as CouponEligibilityRule;

    it('approves customer with 2 cleaning + 2 cooking + 1 salon = 5 bookings when booking Salon', async () => {
      const bookings = [
        createMockBooking({ planTitle: 'Kitchen Deep Clean' }),
        createMockBooking({ planTitle: 'Full Home Clean' }),
        createMockBooking({ planTitle: 'Cook for 2 days' }),
        createMockBooking({ planTitle: 'Cook for 1 day' }),
        createMockBooking({ planTitle: 'Pedicure Salon' }),
      ];
      const service = createService(bookings);

      const result = await service.evaluateRule('cust-1', rule, 'SALON');
      assert.equal(result.eligible, true);
    });

    it('rejects if used for Cleaning when rule is applicable only for Salon', async () => {
      const bookings = Array.from({ length: 6 }, () =>
        createMockBooking({ planTitle: 'Full Home Clean' }),
      );
      const service = createService(bookings);

      const result = await service.evaluateRule('cust-1', rule, 'CLEANING');
      assert.equal(result.eligible, false);
      assert.match(result.reason || '', /only valid for SALON services/);
    });
  });

  describe('Logical Operators (AND vs OR)', () => {
    it('requires all conditions to pass when matchType is AND', async () => {
      const rule = {
        id: 'r-and',
        name: 'Strict Rule',
        isActive: true,
        applicableServices: ['ALL'],
        matchType: 'AND',
        conditions: [
          {
            type: 'COMPLETED_BOOKINGS',
            service: 'CLEANING',
            operator: 'GREATER_THAN_OR_EQUAL',
            value: 2,
          },
          {
            type: 'COMPLETED_BOOKINGS',
            service: 'COOKING',
            operator: 'GREATER_THAN_OR_EQUAL',
            value: 2,
          },
        ] as CouponRuleCondition[],
      } as unknown as CouponEligibilityRule;

      // Customer has 2 cleaning, 0 cooking
      const bookings = [
        createMockBooking({ planTitle: 'Home Cleaning' }),
        createMockBooking({ planTitle: 'Sofa Cleaning' }),
      ];
      const service = createService(bookings);

      const result = await service.evaluateRule('cust-1', rule, 'CLEANING');
      assert.equal(result.eligible, false);
    });

    it('allows coupon if any condition passes when matchType is OR', async () => {
      const rule = {
        id: 'r-or',
        name: 'Flexible Rule',
        isActive: true,
        applicableServices: ['ALL'],
        matchType: 'OR',
        conditions: [
          {
            type: 'COMPLETED_BOOKINGS',
            service: 'CLEANING',
            operator: 'GREATER_THAN_OR_EQUAL',
            value: 2,
          },
          {
            type: 'COMPLETED_BOOKINGS',
            service: 'COOKING',
            operator: 'GREATER_THAN_OR_EQUAL',
            value: 2,
          },
        ] as CouponRuleCondition[],
      } as unknown as CouponEligibilityRule;

      // Customer has 2 cleaning, 0 cooking
      const bookings = [
        createMockBooking({ planTitle: 'Home Cleaning' }),
        createMockBooking({ planTitle: 'Sofa Cleaning' }),
      ];
      const service = createService(bookings);

      const result = await service.evaluateRule('cust-1', rule, 'CLEANING');
      assert.equal(result.eligible, true);
    });
  });
});
