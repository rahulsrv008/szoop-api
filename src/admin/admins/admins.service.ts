import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Admin } from 'src/database/entities';
import { AdminAccessService, AdminZoneRef } from 'src/common/auth/admin-access';
import { AuditService } from 'src/common/services/audit.service';
import { TokenService } from 'src/common/auth/token.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import {
  CreateAdminDto,
  ListAdminsDto,
  UpdateAdminDto,
} from './dto/admins.dto';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AdminAdminsService {
  constructor(
    @InjectRepository(Admin) private readonly adminRepo: Repository<Admin>,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly access: AdminAccessService,
  ) {}

  async list(query: ListAdminsDto) {
    this.access.assertSuperAdmin();
    const { skip, take } = skipTake(query);
    const qb = this.adminRepo.createQueryBuilder('admin');

    if (query.search) {
      qb.andWhere(
        `(admin.email ILIKE :search OR admin.firstName ILIKE :search
          OR admin.lastName ILIKE :search)`,
        { search: `%${query.search.trim()}%` },
      );
    }
    if (query.isActive !== undefined) {
      qb.andWhere('admin.isActive = :isActive', { isActive: query.isActive });
    }
    if (query.role) {
      qb.andWhere('admin.role = :role', { role: query.role });
    }

    const [rows, total] = await qb
      .orderBy('admin.createdAt', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();

    const zoneMap = await this.access.zonesFor(rows.map((admin) => admin.id));
    return paginated(
      rows.map((admin) => this.toProfile(admin, zoneMap.get(admin.id) ?? [])),
      total,
      query,
    );
  }

  async create(actorId: string, dto: CreateAdminDto) {
    this.access.assertSuperAdmin();
    const role = dto.role ?? 'ADMIN';
    this.requireZones(role, dto.zoneIds);
    const email = dto.email.trim().toLowerCase();
    const existing = await this.adminRepo
      .createQueryBuilder('admin')
      .where('LOWER(admin.email) = :email', { email })
      .getOne();
    if (existing) throw new ConflictException('An admin with that email exists');

    const admin = await this.adminRepo.save(
      this.adminRepo.create({
        email,
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        firstName: dto.firstName?.trim() || null,
        lastName: dto.lastName?.trim() || null,
        role,
        isActive: true,
      }),
    );
    if (role !== 'SUPER_ADMIN') {
      await this.access.replaceZones(admin.id, dto.zoneIds ?? []);
    }

    await this.audit.record({
      userId: actorId,
      action: 'ADMIN_CREATED',
      entityType: 'admins',
      entityId: admin.id,
      oldData: null,
      newData: this.toProfile(admin),
    });

    const zoneMap = await this.access.zonesFor([admin.id]);
    return this.toProfile(admin, zoneMap.get(admin.id) ?? []);
  }

  async update(actorId: string, id: string, dto: UpdateAdminDto) {
    this.access.assertSuperAdmin();
    const admin = await this.requireAdmin(id);
    const oldData = this.toProfile(admin);

    if (dto.email) {
      const email = dto.email.trim().toLowerCase();
      const clash = await this.adminRepo
        .createQueryBuilder('admin')
        .where('LOWER(admin.email) = :email', { email })
        .andWhere('admin.id != :id', { id })
        .getOne();
      if (clash) throw new ConflictException('An admin with that email exists');
      admin.email = email;
    }
    if (dto.firstName !== undefined) admin.firstName = dto.firstName.trim() || null;
    if (dto.lastName !== undefined) admin.lastName = dto.lastName.trim() || null;
    if (dto.role !== undefined) {
      if (admin.role === 'SUPER_ADMIN' && dto.role !== 'SUPER_ADMIN') {
        await this.assertAnotherSuperAdmin(admin.id);
      }
      admin.role = dto.role;
    }
    const nextRole = admin.role;
    if (nextRole === 'SUPER_ADMIN') {
      await this.access.replaceZones(admin.id, []);
    } else if (dto.zoneIds) {
      this.requireZones(nextRole, dto.zoneIds);
      await this.access.replaceZones(admin.id, dto.zoneIds);
    } else {
      const existing = await this.access.zonesFor([admin.id]);
      this.requireZones(nextRole, (existing.get(admin.id) ?? []).map((zone) => zone.id));
    }

    let passwordReset = false;
    if (dto.password) {
      admin.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
      passwordReset = true;
    }

    await this.adminRepo.save(admin);

    if (passwordReset) {
      await this.tokens.revokeAllForSubject({ sub: admin.id, role: 'admin' });
    }

    await this.audit.record({
      userId: actorId,
      action: passwordReset ? 'ADMIN_UPDATED_WITH_PASSWORD' : 'ADMIN_UPDATED',
      entityType: 'admins',
      entityId: admin.id,
      oldData,
      newData: this.toProfile(admin),
    });

    const zoneMap = await this.access.zonesFor([admin.id]);
    return {
      ...this.toProfile(admin, zoneMap.get(admin.id) ?? []),
      passwordReset,
      message: passwordReset
        ? 'Admin updated. Their other sessions were signed out.'
        : 'Admin updated',
    };
  }

  async activate(actorId: string, id: string) {
    this.access.assertSuperAdmin();
    const admin = await this.requireAdmin(id);
    if (admin.isActive) {
      throw new BadRequestException('Admin is already active');
    }

    admin.isActive = true;
    await this.adminRepo.save(admin);

    await this.audit.record({
      userId: actorId,
      action: 'ADMIN_ACTIVATED',
      entityType: 'admins',
      entityId: admin.id,
      oldData: { isActive: false },
      newData: { isActive: true },
    });

    const zoneMap = await this.access.zonesFor([admin.id]);
    return {
      ...this.toProfile(admin, zoneMap.get(admin.id) ?? []),
      message: 'Admin activated',
    };
  }

  async deactivate(actorId: string, id: string) {
    this.access.assertSuperAdmin();
    if (actorId === id) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const admin = await this.requireAdmin(id);
    if (admin.role === 'SUPER_ADMIN') {
      await this.assertAnotherSuperAdmin(admin.id);
    }
    if (!admin.isActive) {
      throw new BadRequestException('Admin is already inactive');
    }

    admin.isActive = false;
    await this.adminRepo.save(admin);
    await this.tokens.revokeAllForSubject({ sub: admin.id, role: 'admin' });

    await this.audit.record({
      userId: actorId,
      action: 'ADMIN_DEACTIVATED',
      entityType: 'admins',
      entityId: admin.id,
      oldData: { isActive: true },
      newData: { isActive: false },
    });

    const zoneMap = await this.access.zonesFor([admin.id]);
    return {
      ...this.toProfile(admin, zoneMap.get(admin.id) ?? []),
      message: 'Admin deactivated and sessions revoked',
    };
  }

  private async requireAdmin(id: string) {
    const admin = await this.adminRepo.findOne({ where: { id } });
    if (!admin) throw new NotFoundException('Admin not found');
    return admin;
  }

  private requireZones(role: string, zoneIds?: string[]) {
    if (role === 'SUPER_ADMIN') return;
    if (!zoneIds?.length) {
      throw new BadRequestException(
        'Assign at least one zone. Only a super admin can see every zone.',
      );
    }
  }

  private async assertAnotherSuperAdmin(exceptId: string) {
    const others = await this.adminRepo.count({
      where: { role: 'SUPER_ADMIN', isActive: true },
    });
    const self = await this.adminRepo.findOne({
      where: { id: exceptId, role: 'SUPER_ADMIN', isActive: true },
      select: ['id'],
    });
    if (self && others <= 1) {
      throw new BadRequestException('Keep at least one active super admin');
    }
  }

  private toProfile(admin: Admin, zones: AdminZoneRef[] = []) {
    return {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: admin.role,
      isActive: admin.isActive,
      createdAt: admin.createdAt,
      unrestricted: admin.role === 'SUPER_ADMIN',
      zones: admin.role === 'SUPER_ADMIN' ? [] : zones,
    };
  }
}
