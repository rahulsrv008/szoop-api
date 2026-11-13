import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { IdentityService } from '../auth/identity.service';
import { TokenService } from '../auth/token.service';
import { AuthUser } from '../types/auth.types';
import { clientAppCode } from '../types/client-app';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthUser;
      url?: string;
    }>();

    const rawHeader = req.headers?.authorization;
    const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const user = this.tokens.verifyAccessToken(header.slice(7));
    if (user.role === 'customer') {
      const requestApp = clientAppCode(req.headers?.['x-client-app']);
      if ((user.appCode ?? 'SZOOP') !== requestApp) {
        throw new UnauthorizedException('Account belongs to a different application');
      }
    }
    const isLogout = req.url?.includes('/logout');
    if (!isLogout) {
      await this.identity.assertActive(user);
    }
    req.user = user;
    return true;
  }
}
