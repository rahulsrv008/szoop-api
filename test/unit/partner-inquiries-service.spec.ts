import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Repository } from 'typeorm';
import type { AdminAccessService } from '../../src/common/auth/admin-access';
import { PartnerInquiry } from '../../src/database/entities';
import { PartnerInquiriesService } from '../../src/web/partner-inquiries/partner-inquiries.service';

describe('PartnerInquiriesService', () => {
  it('saves an inquiry submitted through the public form', async () => {
    const inquiry = {
      name: 'Alex Example',
      phone: '+1 415 555 0123',
      city: 'San Francisco',
      partnerType: 'Beauty professional',
    };
    let saved: PartnerInquiry | undefined;
    const repo = {
      create: (value: Partial<PartnerInquiry>) => value,
      save: async (value: PartnerInquiry) => {
        saved = value;
        return value;
      },
    } as unknown as Repository<PartnerInquiry>;
    const service = new PartnerInquiriesService(repo, {} as AdminAccessService);

    await service.create(inquiry);

    assert.deepEqual(saved, inquiry);
  });

  it('returns newest inquiries in a searchable paginated response for admins', async () => {
    const items = [
      {
        id: 'inquiry-1',
        name: 'Alex Example',
        phone: '+1 415 555 0123',
        city: 'San Francisco',
        partnerType: 'Beauty professional',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ] as PartnerInquiry[];
    let offset = -1;
    let limit = -1;
    let condition = '';
    let parameters: Record<string, string> = {};
    let superAdminChecked = false;
    const queryBuilder = {
      select: () => queryBuilder,
      orderBy: () => queryBuilder,
      skip: (value: number) => {
        offset = value;
        return queryBuilder;
      },
      take: (value: number) => {
        limit = value;
        return queryBuilder;
      },
      andWhere: (sql: string, values: Record<string, string>) => {
        condition = sql;
        parameters = values;
        return queryBuilder;
      },
      getManyAndCount: async () => [items, 21] as [PartnerInquiry[], number],
    };
    const repo = {
      createQueryBuilder: () => queryBuilder,
    } as unknown as Repository<PartnerInquiry>;
    const access = {
      assertSuperAdmin: () => {
        superAdminChecked = true;
      },
    } as unknown as AdminAccessService;
    const service = new PartnerInquiriesService(repo, access);

    const result = await service.list({ page: 2, limit: 10, search: 'Alex' });

    assert.equal(superAdminChecked, true);
    assert.equal(offset, 10);
    assert.equal(limit, 10);
    assert.match(condition, /partnerType/);
    assert.deepEqual(parameters, { search: '%Alex%' });
    assert.deepEqual(result, {
      items,
      meta: { page: 2, limit: 10, total: 21, totalPages: 3 },
    });
  });
});
