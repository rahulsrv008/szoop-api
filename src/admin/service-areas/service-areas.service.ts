import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import {
  Booking,
  ServiceArea,
  ServicePricing,
  ServiceZoneArea,
} from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { AuditService } from 'src/common/services/audit.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import {
  NCR_SERVICE_ZONES,
  STATE_BY_CITY,
} from 'src/database/seeds/ncr-service-zones.data';
import { ListAdminServiceAreasDto } from './dto/list-service-areas.dto';
import {
  CreateAdminServiceAreaDto,
  ServiceZoneAreaItemDto,
} from './dto/create-service-area.dto';
import { ZoneResolverService } from 'src/common/services/zone-resolver.service';
import { UpdateAdminServiceAreaDto } from './dto/update-service-area.dto';

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS service_areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(150) NOT NULL,
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE service_areas ADD COLUMN IF NOT EXISTS code VARCHAR(32);
ALTER TABLE service_areas ADD COLUMN IF NOT EXISTS region VARCHAR(50);
ALTER TABLE service_areas ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE service_areas ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE service_areas ADD COLUMN IF NOT EXISTS service_radius_km INT DEFAULT 3;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_areas_code
  ON service_areas (code)
  WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS service_zone_areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_area_id UUID NOT NULL REFERENCES service_areas(id) ON DELETE CASCADE,
  area_name VARCHAR(150) NOT NULL,
  pincode VARCHAR(10),
  buildings_cover JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_zone_areas_area_id
  ON service_zone_areas (service_area_id);

CREATE INDEX IF NOT EXISTS idx_service_zone_areas_pincode
  ON service_zone_areas (pincode);
`;

@Injectable()
export class AdminServiceAreasService implements OnModuleInit {
  private readonly logger = new Logger(AdminServiceAreasService.name);

  constructor(
    @InjectRepository(ServiceArea)
    private readonly areaRepo: Repository<ServiceArea>,
    @InjectRepository(ServiceZoneArea)
    private readonly zoneAreaRepo: Repository<ServiceZoneArea>,
    @InjectRepository(ServicePricing)
    private readonly pricingRepo: Repository<ServicePricing>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly access: AdminAccessService,
    private readonly zones: ZoneResolverService,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureSchema();
      await this.seedCatalog();
    } catch (err) {
      this.logger.error('Failed to ensure service zone schema/catalog', err as Error);
    }
  }

  async list(query: ListAdminServiceAreasDto) {
    const { skip, take } = skipTake(query);

    const filtered = this.applyFilters(
      this.areaRepo.createQueryBuilder('area'),
      query,
    );

    const [rows, total] = await Promise.all([
      filtered
        .clone()
        .leftJoinAndSelect('area.zoneAreas', 'zoneArea')
        .orderBy('area.name', 'ASC')
        .addOrderBy('zoneArea.sortOrder', 'ASC')
        .skip(skip)
        .take(take)
        .getMany(),
      filtered.clone().getCount(),
    ]);

    return paginated(rows.map((row) => this.toDto(row)), total, query);
  }

  async create(adminId: string, dto: CreateAdminServiceAreaDto) {
    await this.assertUniqueCode(dto.code);

    const area = this.areaRepo.create(this.applyFields(new ServiceArea(), dto));
    const saved = await this.areaRepo.save(area);
    await this.replaceZoneAreas(saved.id, dto.areas);
    this.zones.invalidateCache();
    const full = await this.requireArea(saved.id);

    await this.audit.record({
      userId: adminId,
      action: 'SERVICE_AREA_CREATED',
      entityType: 'service_areas',
      entityId: full.id,
      oldData: null,
      newData: this.snapshot(full),
    });

    return this.toDto(full);
  }

  async update(adminId: string, id: string, dto: UpdateAdminServiceAreaDto) {
    const area = await this.requireArea(id);
    const oldData = this.snapshot(area);
    await this.assertUniqueCode(dto.code, id);

    this.applyFields(area, dto);
    await this.areaRepo.save(area);
    if (dto.areas !== undefined) {
      await this.replaceZoneAreas(id, dto.areas);
    }
    this.zones.invalidateCache();
    const full = await this.requireArea(id);

    await this.audit.record({
      userId: adminId,
      action: 'SERVICE_AREA_UPDATED',
      entityType: 'service_areas',
      entityId: area.id,
      oldData,
      newData: this.snapshot(full),
    });

    return this.toDto(full);
  }

  /** Areas referenced by bookings or pricing are deactivated, not deleted. */
  async remove(adminId: string, id: string) {
    const area = await this.requireArea(id);
    const oldData = this.snapshot(area);

    const [bookingCount, pricingCount] = await Promise.all([
      this.bookingRepo.count({ where: { serviceAreaId: id } }),
      this.pricingRepo.count({ where: { serviceAreaId: id } }),
    ]);

    if (bookingCount || pricingCount) {
      if (!area.isActive) {
        throw new BadRequestException('Service area is already deactivated');
      }
      area.isActive = false;
      await this.areaRepo.save(area);
      this.zones.invalidateCache();

      await this.audit.record({
        userId: adminId,
        action: 'SERVICE_AREA_DEACTIVATED',
        entityType: 'service_areas',
        entityId: area.id,
        oldData,
        newData: this.snapshot(area),
      });

      return {
        deleted: false,
        deactivated: true,
        reason: `Service area is referenced by ${bookingCount} booking(s) and ${pricingCount} price row(s), so it was deactivated instead of deleted`,
      };
    }

    await this.areaRepo.delete({ id });
    this.zones.invalidateCache();

    await this.audit.record({
      userId: adminId,
      action: 'SERVICE_AREA_DELETED',
      entityType: 'service_areas',
      entityId: id,
      oldData,
      newData: null,
    });

    return { deleted: true, deactivated: false, reason: null };
  }

  private applyFilters(
    qb: SelectQueryBuilder<ServiceArea>,
    query: ListAdminServiceAreasDto,
  ) {
    if (query.search) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        `(area.name ILIKE :search
          OR area.city ILIKE :search
          OR area.region ILIKE :search
          OR area.code ILIKE :search
          OR area.pincode ILIKE :search
          OR EXISTS (
            SELECT 1 FROM service_zone_areas za
            WHERE za.service_area_id = area.id
              AND (za.area_name ILIKE :search OR za.pincode ILIKE :search)
          ))`,
        { search },
      );
    }
    if (query.isActive !== undefined) {
      qb.andWhere('area.isActive = :isActive', { isActive: query.isActive });
    }
    if (query.city) {
      qb.andWhere('area.city ILIKE :city', { city: query.city.trim() });
    }
    if (query.region) {
      qb.andWhere('area.region = :region', { region: query.region.trim() });
    }
    this.access.restrictZoneColumn(qb, 'area.id');
    return qb;
  }

  private async requireArea(id: string) {
    const area = await this.areaRepo.findOne({
      where: { id },
      relations: ['zoneAreas'],
      order: { zoneAreas: { sortOrder: 'ASC' } },
    });
    if (!area) throw new NotFoundException('Service area not found');
    this.access.assertZone(area.id, 'Service area');
    return area;
  }

  private async assertUniqueCode(code?: string | null, ignoreId?: string) {
    const value = code?.trim();
    if (!value) return;
    const existing = await this.areaRepo.findOne({ where: { code: value } });
    if (existing && existing.id !== ignoreId) {
      throw new BadRequestException(`Zone code ${value} is already in use`);
    }
  }

  private applyFields(
    area: ServiceArea,
    dto: CreateAdminServiceAreaDto | UpdateAdminServiceAreaDto,
  ) {
    if (dto.name !== undefined) area.name = dto.name.trim();
    if (dto.code !== undefined) area.code = dto.code?.trim() || null;
    if (dto.city !== undefined) area.city = dto.city?.trim() || null;
    if (dto.region !== undefined) area.region = dto.region?.trim() || null;
    if (dto.state !== undefined) {
      area.state = dto.state?.trim() || null;
    } else if (dto.city && !area.state) {
      area.state = STATE_BY_CITY[dto.city.trim()] ?? area.state;
    }
    if (dto.pincode !== undefined) area.pincode = dto.pincode ?? null;
    if (dto.latitude !== undefined) area.latitude = dto.latitude ?? null;
    if (dto.longitude !== undefined) area.longitude = dto.longitude ?? null;
    if (dto.serviceRadiusKm !== undefined) {
      area.serviceRadiusKm = dto.serviceRadiusKm;
    }
    if (dto.isActive !== undefined) area.isActive = dto.isActive;
    if (dto.areas?.length && dto.pincode === undefined) {
      area.pincode = dto.areas[0]?.pincode ?? area.pincode;
    }
    return area;
  }

  private async replaceZoneAreas(
    serviceAreaId: string,
    areas?: ServiceZoneAreaItemDto[],
  ) {
    await this.zoneAreaRepo.delete({ serviceAreaId });
    if (!areas?.length) return;
    await this.zoneAreaRepo.save(
      areas.map((item, index) =>
        this.zoneAreaRepo.create({
          serviceAreaId,
          areaName: item.area.trim(),
          pincode: item.pincode,
          buildingsCover: item.buildingsCover ?? [],
          sortOrder: index,
        }),
      ),
    );
  }

  private toDto(area: ServiceArea) {
    const zoneAreas = [...(area.zoneAreas ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    return {
      id: area.id,
      code: area.code,
      name: area.name,
      city: area.city,
      region: area.region,
      state: area.state,
      pincode: area.pincode,
      latitude: area.latitude,
      longitude: area.longitude,
      serviceRadiusKm: area.serviceRadiusKm,
      isActive: area.isActive,
      createdAt: area.createdAt,
      areas: zoneAreas.map((item) => ({
        area: item.areaName,
        pincode: item.pincode,
        buildingsCover: item.buildingsCover ?? [],
      })),
    };
  }

  private snapshot(area: ServiceArea) {
    return this.toDto(area);
  }

  private async ensureSchema() {
    await this.dataSource.query(SCHEMA_SQL);
  }

  private async seedCatalog() {
    for (const entry of NCR_SERVICE_ZONES) {
      const code = entry.zone.id;
      let area = await this.areaRepo.findOne({ where: { code } });
      if (!area) {
        area = this.areaRepo.create({ code, name: entry.zone.name });
      }

      area.name = entry.zone.name;
      area.city = entry.city;
      area.region = entry.region;
      area.state = STATE_BY_CITY[entry.city] ?? area.state;
      area.latitude = entry.zone.zone_center.latitude;
      area.longitude = entry.zone.zone_center.longitude;
      area.serviceRadiusKm = entry.zone.service_radius_km;
      area.pincode = entry.zone.areas[0]?.pincode ?? area.pincode;
      area.isActive = area.isActive ?? true;

      const saved = await this.areaRepo.save(area);
      await this.replaceZoneAreas(
        saved.id,
        entry.zone.areas.map((item) => ({
          area: item.area,
          pincode: item.pincode,
          buildingsCover: item.buildings_cover,
        })),
      );
    }
    this.zones.invalidateCache();
    this.logger.log(`Synced ${NCR_SERVICE_ZONES.length} NCR service zones`);
  }
}
