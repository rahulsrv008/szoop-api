import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePartnerInquiryDto } from '../../src/web/partner-inquiries/dto/create-partner-inquiry.dto';

describe('CreatePartnerInquiryDto validation', () => {
  it('accepts a valid inquiry and normalizes blank optional fields', async () => {
    const dto = plainToInstance(CreatePartnerInquiryDto, {
      name: '  Alex Example ',
      phone: '+1 (415) 555-0123',
      email: ' ',
      city: '  San Francisco ',
      partnerType: 'Beauty professional',
      note: ' ',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.equal(dto.name, 'Alex Example');
    assert.equal(dto.city, 'San Francisco');
    assert.equal(dto.email, undefined);
    assert.equal(dto.note, undefined);
  });

  it('rejects invalid email, phone, and partnership type', async () => {
    const dto = plainToInstance(CreatePartnerInquiryDto, {
      name: 'Alex Example',
      phone: 'call me',
      email: 'not-an-email',
      city: 'San Francisco',
      partnerType: 'Unlisted option',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    assert.deepEqual(errors.map((error) => error.property).sort(), [
      'email',
      'partnerType',
      'phone',
    ]);
  });
});
