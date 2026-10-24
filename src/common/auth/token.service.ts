import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { RefreshToken } from 'src/database/entities';
import { AuthUser } from '../types/auth.types';
import { IdentityService } from './identity.service';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Access tokens are stateless JWTs; refresh tokens are opaque random strings
 * stored hashed in `refresh_tokens` so logout and rotation actually revoke.
 */
@Injectable()
export class TokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
    private readonly config: ConfigService,
    private readonly identity: IdentityService,
  ) {}

  async issueSession(user: AuthUser): Promise<IssuedSession> {
    const accessToken = this.signAccessToken(user);
    const refreshTtl = this.refreshTtlSeconds();
    const raw = randomBytes(48).toString('hex');

    await this.refreshRepo.save(
      this.refreshRepo.create({
        userId: user.role === 'admin' ? null : user.sub,
        adminId: user.role === 'admin' ? user.sub : null,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      }),
    );

    return {
      accessToken,
      refreshToken: raw,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds(),
      refreshExpiresIn: refreshTtl,
    };
  }

  /** Validates + rotates a refresh token, returning a brand new session. */
  async rotate(rawToken: string, role: AuthUser['role']): Promise<IssuedSession> {
    const row = await this.refreshRepo.findOne({
      where: { tokenHash: sha256(rawToken), revokedAt: IsNull() },
    });
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    if (row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const isAdminToken = !!row.adminId;
    if ((role === 'admin') !== isAdminToken) {
      throw new UnauthorizedException('Refresh token does not belong to this app');
    }

    row.revokedAt = new Date();
    await this.refreshRepo.save(row);

    const user =
      role === 'admin'
        ? await this.identity.buildAdminAuthUser(row.adminId as string)
        : await this.identity.buildAuthUser(row.userId as string, role);

    return this.issueSession(user);
  }

  async revoke(rawToken: string) {
    const row = await this.refreshRepo.findOne({
      where: { tokenHash: sha256(rawToken), revokedAt: IsNull() },
    });
    if (!row) return { revoked: 0 };
    row.revokedAt = new Date();
    await this.refreshRepo.save(row);
    return { revoked: 1 };
  }

  async revokeAllForSubject(user: AuthUser) {
    const where =
      user.role === 'admin' ? { adminId: user.sub } : { userId: user.sub };
    const result = await this.refreshRepo.update(
      { ...where, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return { revoked: result.affected ?? 0 };
  }

  /** Housekeeping helper — safe to call from a cron/worker later. */
  purgeExpired() {
    return this.refreshRepo.delete({ expiresAt: LessThan(new Date()) });
  }

  verifyAccessToken(token: string): AuthUser {
    try {
      return jwt.verify(token, this.accessSecret(), {
        algorithms: ['HS256'],
      }) as AuthUser;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private signAccessToken(user: AuthUser) {
    const payload: AuthUser = {
      sub: user.sub,
      role: user.role,
      phone: user.phone,
      email: user.email,
      customerId: user.customerId,
      agentId: user.agentId,
      adminId: user.adminId,
    };
    return jwt.sign(payload, this.accessSecret(), {
      algorithm: 'HS256',
      expiresIn: this.accessTtlSeconds(),
    });
  }

  private accessSecret() {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new InternalServerErrorException('JWT_SECRET is not configured');
    }
    return secret;
  }

  private accessTtlSeconds() {
    return parseInt(
      this.config.get<string>('JWT_ACCESS_TTL_SECONDS') || '86400',
      10,
    );
  }

  private refreshTtlSeconds() {
    return parseInt(
      this.config.get<string>('JWT_REFRESH_TTL_SECONDS') || '2592000',
      10,
    );
  }
}
