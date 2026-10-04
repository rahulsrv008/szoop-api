import { AsyncLocalStorage } from 'async_hooks';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { Admin, AdminZone, CustomerAddress, ServiceArea } from 'src/database/entities';

export interface AdminZoneRef {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
}

export interface AdminAccess {
  adminId: string;
  role: string;
  unrestricted: boolean;
  zoneIds: string[];
}

export const adminAccessStore = new AsyncLocalStorage<AdminAccess>();

const ZONE_PARAM = 'scopeZoneIds';

@Injectable()
export class AdminAccessService {
  constructor(
    @InjectRepository(Admin) private readonly adminRepo: Repository<Admin>,
    @InjectRepository(AdminZone)
    private readonly zoneRepo: Repository<AdminZone>,
    @InjectRepository(ServiceArea)
    private readonly areaRepo: Repository<ServiceArea>,
    @InjectRepository(CustomerAddress)
    private readonly addressRepo: Repository<CustomerAddress>,
  ) {}

  async load(adminId: string): Promise<AdminAccess> {
    const admin = await this.adminRepo.findOne({
      where: { id: adminId },
      select: ['id', 'role', 'isActive'],
    });
    if (!admin?.isActive) {
      throw new ForbiddenException('This admin account is disabled');
    }
    if (admin.role === 'SUPER_ADMIN') {
      return {
        adminId: admin.id,
        role: admin.role,
        unrestricted: true,
        zoneIds: [],
      };
    }
    const rows = await this.zoneRepo.find({
      where: { adminId: admin.id },
      select: ['serviceAreaId'],
    });
    return {
      adminId: admin.id,
      role: admin.role,
      unrestricted: false,
      zoneIds: rows.map((row) => row.serviceAreaId),
    };
  }

  current(): AdminAccess {
    const access = adminAccessStore.getStore();
    if (!access) {
      throw new ForbiddenException('Admin zone scope is not available');
    }
    return access;
  }

  assertSuperAdmin() {
    const access = this.current();
    if (!access.unrestricted) {
      throw new ForbiddenException(
        'Only a super admin can manage users and platform settings',
      );
    }
  }

  /** Hide a row whose zone is outside this admin's assignment. */
  assertZone(zoneId: string | null | undefined, label = 'Record') {
    const access = this.current();
    if (access.unrestricted) return;
    if (!zoneId || !access.zoneIds.includes(zoneId)) {
      throw new NotFoundException(`${label} not found`);
    }
  }

  assertAgent(agent: {
    homeZoneId: string | null;
    serviceAreas?: string[] | null;
  }) {
    const access = this.current();
    if (access.unrestricted) return;
    const areas = agent.serviceAreas ?? [];
    const visible =
      (!!agent.homeZoneId && access.zoneIds.includes(agent.homeZoneId)) ||
      areas.some((id) => access.zoneIds.includes(id));
    if (!visible) throw new NotFoundException('Agent not found');
  }

  async assertCustomer(customerId: string, homeZoneId: string | null) {
    const access = this.current();
    if (access.unrestricted) return;
    if (homeZoneId && access.zoneIds.includes(homeZoneId)) return;
    if (!access.zoneIds.length) {
      throw new NotFoundException('Customer not found');
    }
    const address = await this.addressRepo.findOne({
      where: { customerId, serviceAreaId: In(access.zoneIds) },
      select: ['id'],
    });
    if (!address) throw new NotFoundException('Customer not found');
  }

  assertSupport(ticket: {
    bookingZoneId?: string | null;
    customerZoneId?: string | null;
    agentHomeZoneId?: string | null;
    agentServiceAreas?: string[] | null;
  }) {
    const access = this.current();
    if (access.unrestricted) return;
    const zones = [
      ticket.bookingZoneId,
      ticket.customerZoneId,
      ticket.agentHomeZoneId,
      ...(ticket.agentServiceAreas ?? []),
    ].filter((id): id is string => !!id);
    if (!zones.some((id) => access.zoneIds.includes(id))) {
      throw new NotFoundException('Support ticket not found');
    }
  }

  restrictZoneColumn<T extends object>(
    qb: SelectQueryBuilder<T>,
    column: string,
  ) {
    return this.bind(qb, `${column} IN (:...${ZONE_PARAM})`);
  }

  restrictAgent<T extends object>(qb: SelectQueryBuilder<T>, alias: string) {
    return this.bind(
      qb,
      `(${alias}.home_zone IN (:...${ZONE_PARAM})
        OR EXISTS (
          SELECT 1 FROM unnest(${alias}.service_areas) AS zone_id
          WHERE zone_id IN (:...${ZONE_PARAM})
        ))`,
    );
  }

  restrictCustomer<T extends object>(qb: SelectQueryBuilder<T>, alias: string) {
    return this.bind(
      qb,
      `(${alias}.home_zone IN (:...${ZONE_PARAM})
        OR EXISTS (
          SELECT 1 FROM customer_addresses addr
          WHERE addr.customer_id = ${alias}.id
            AND addr.service_area_id IN (:...${ZONE_PARAM})
        ))`,
    );
  }

  restrictSupport<T extends object>(qb: SelectQueryBuilder<T>) {
    return this.bind(
      qb,
      `(booking.service_area_id IN (:...${ZONE_PARAM})
        OR customer.home_zone IN (:...${ZONE_PARAM})
        OR agent.home_zone IN (:...${ZONE_PARAM})
        OR EXISTS (
          SELECT 1 FROM unnest(agent.service_areas) AS zone_id
          WHERE zone_id IN (:...${ZONE_PARAM})
        ))`,
    );
  }

  async zonesFor(adminIds: string[]): Promise<Map<string, AdminZoneRef[]>> {
    const grouped = new Map<string, AdminZoneRef[]>();
    if (!adminIds.length) return grouped;
    const rows = await this.zoneRepo.find({
      where: { adminId: In(adminIds) },
      relations: ['serviceArea'],
    });
    for (const row of rows) {
      const list = grouped.get(row.adminId) ?? [];
      if (row.serviceArea) {
        list.push({
          id: row.serviceArea.id,
          name: row.serviceArea.name,
          code: row.serviceArea.code,
          city: row.serviceArea.city,
        });
      }
      grouped.set(row.adminId, list);
    }
    return grouped;
  }

  async replaceZones(adminId: string, zoneIds: string[]) {
    const unique = [...new Set(zoneIds)];
    if (unique.length) {
      const found = await this.areaRepo.find({
        where: { id: In(unique) },
        select: ['id'],
      });
      if (found.length !== unique.length) {
        throw new NotFoundException('One or more zones were not found');
      }
    }
    await this.zoneRepo.delete({ adminId });
    if (!unique.length) return;
    await this.zoneRepo.save(
      unique.map((serviceAreaId) =>
        this.zoneRepo.create({ adminId, serviceAreaId }),
      ),
    );
  }

  private bind<T extends object>(qb: SelectQueryBuilder<T>, sql: string) {
    const access = this.current();
    if (access.unrestricted) return qb;
    if (!access.zoneIds.length) {
      qb.andWhere('1 = 0');
      return qb;
    }
    qb.andWhere(sql, { [ZONE_PARAM]: access.zoneIds });
    return qb;
  }
}
