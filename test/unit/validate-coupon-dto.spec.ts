import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ValidateCustomerCouponDto } from '../../src/customer/coupons/dto/validate-coupon.dto';

describe('ValidateCustomerCouponDto validation', () => {
  it('accepts service property without throwing non-whitelisted property error', async () => {
    const raw = {
      code: 'SZOOP30',
      subtotal: 499,
      service: 'CLEANING',
    };

    const instance = plainToInstance(ValidateCustomerCouponDto, raw);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    assert.equal(errors.length, 0, `Expected 0 validation errors, got ${JSON.stringify(errors)}`);
    assert.equal(instance.service, 'CLEANING');
  });

  it('transforms lowercase service to uppercase', async () => {
    const raw = {
      code: 'SZOOP30',
      subtotal: 499,
      service: 'salon',
    };

    const instance = plainToInstance(ValidateCustomerCouponDto, raw);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    assert.equal(errors.length, 0);
    assert.equal(instance.service, 'SALON');
  });

  it('accepts validation without service property', async () => {
    const raw = {
      code: 'SZOOP30',
      subtotal: 499,
    };

    const instance = plainToInstance(ValidateCustomerCouponDto, raw);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    assert.equal(errors.length, 0);
    assert.equal(instance.service, undefined);
  });
});
