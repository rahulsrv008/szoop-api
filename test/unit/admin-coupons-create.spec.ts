import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AdminCouponsService } from '../../src/admin/coupons/coupons.service';

describe('AdminCouponsService - create coupon handling', () => {
  it('creates coupon without errors when maxDiscount, minOrderAmount, and eligibilityRuleId are null', async () => {
    let savedEntity: any = null;

    const couponRepoMock = {
      findOne: async () => null, // No existing code
      create: (data: any) => data,
      save: async (entity: any) => {
        savedEntity = { id: 'coupon-uuid-1', ...entity };
        return savedEntity;
      },
    };

    const couponCustomerRepoMock = {
      create: (d: any) => d,
      save: async () => [],
    };

    const usageRepoMock = {};

    const auditMock = {
      record: async () => {},
    };

    const service = new AdminCouponsService(
      couponRepoMock as any,
      couponCustomerRepoMock as any,
      usageRepoMock as any,
      auditMock as any,
    );

    // Override requireCoupon so it returns the savedEntity
    (service as any).requireCoupon = async () => savedEntity;

    const result = await service.create('admin-1', {
      code: 'TESTPROMO',
      discountType: 'FLAT',
      discountValue: 100,
      maxDiscount: null,
      minOrderAmount: null,
      eligibilityRuleId: null,
      customerId: null,
      isActive: true,
    } as any);

    assert.equal(result.code, 'TESTPROMO');
    assert.equal(result.discountValue, 100);
    assert.equal(result.maxDiscount, null);
    assert.equal(result.minOrderAmount, null);
    assert.equal(result.eligibilityRuleId, null);
    assert.equal(savedEntity.maxDiscount, null);
    assert.equal(savedEntity.minOrderAmount, null);
  });
});
