import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { IdentityService } from '../auth/identity.service';
import { TokenService } from '../auth/token.service';
import { AuthUser } from '../types/auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthUser;
      url?: string;
    }>();

    const header = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const user = this.tokens.verifyAccessToken(header.slice(7));
    const isLogout = req.url?.includes('/logout');
    if (!isLogout) {
      await this.identity.assertActive(user);
    }
    req.user = user;
    return true;
  }
}
