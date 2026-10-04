import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Admin } from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { IdentityService } from 'src/common/auth/identity.service';
import { TokenService } from 'src/common/auth/token.service';
import { AuditService } from 'src/common/services/audit.service';
import { AuthUser } from 'src/common/types/auth.types';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(Admin) private readonly adminRepo: Repository<Admin>,
    private readonly identity: IdentityService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly access: AdminAccessService,
  ) {}

  async login(email: string, password: string) {
    const admin = await this.adminRepo
      .createQueryBuilder('admin')
      .where('LOWER(admin.email) = LOWER(:email)', { email: email.trim() })
      .getOne();

    // Same message for unknown email and wrong password so the login form
    // cannot be used to enumerate admin accounts.
    if (!admin) throw new UnauthorizedException('Invalid email or password');

    const matches = await bcrypt.compare(password, admin.passwordHash);
    if (!matches) throw new UnauthorizedException('Invalid email or password');

    if (!admin.isActive) {
      throw new ForbiddenException('This admin account is disabled');
    }

    const authUser = await this.identity.buildAdminAuthUser(admin.id);
    const session = await this.tokens.issueSession(authUser);

    return { ...session, admin: await this.toProfile(admin) };
  }

  refresh(refreshToken: string) {
    return this.tokens.rotate(refreshToken, 'admin');
  }

  logout(user: AuthUser, refreshToken?: string) {
    return refreshToken
      ? this.tokens.revoke(refreshToken)
      : this.tokens.revokeAllForSubject(user);
  }

  async me(adminId: string) {
    return this.toProfile(await this.requireAdmin(adminId));
  }

  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const admin = await this.requireAdmin(adminId);

    const matches = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    admin.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.adminRepo.save(admin);

    // Every refresh token is dropped, so other browsers have to sign in again.
    const revoked = await this.tokens.revokeAllForSubject({
      sub: admin.id,
      role: 'admin',
    });

    // Passwords are never written to the audit trail.
    await this.audit.record({
      userId: adminId,
      action: 'ADMIN_PASSWORD_CHANGED',
      entityType: 'admins',
      entityId: admin.id,
      oldData: { passwordChangedAt: null },
      newData: { passwordChangedAt: new Date().toISOString() },
    });

    return {
      updated: true,
      sessionsRevoked: revoked.revoked,
      message: 'Password changed. Please sign in again on your other devices.',
    };
  }

  private async requireAdmin(adminId: string) {
    const admin = await this.adminRepo.findOne({ where: { id: adminId } });
    if (!admin) throw new NotFoundException('Admin not found');
    return admin;
  }

  private async toProfile(admin: Admin) {
    const zoneMap = await this.access.zonesFor([admin.id]);
    const zones = zoneMap.get(admin.id) ?? [];
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
