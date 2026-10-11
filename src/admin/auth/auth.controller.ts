import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AuthUser } from 'src/common/types/auth.types';
import { AdminAuthService } from './auth.service';
import { AdminLoginDto } from './dto/login.dto';
import { AdminRefreshTokenDto } from './dto/refresh-token.dto';
import { AdminLogoutDto } from './dto/logout.dto';
import { AdminChangePasswordDto } from './dto/change-password.dto';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';

@ApiTags('admin')
@Controller(ROUTES.ADMIN.AUTH)
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  @RateLimit(RATE_LIMITS.ADMIN_LOGIN)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Admin Web login with email and password' })
  login(@Body() dto: AdminLoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('refresh-token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a refresh token for a new admin session' })
  refresh(@Body() dto: AdminRefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  @AdminAuth()
  @ApiOperation({
    summary: 'Revoke one session, or all sessions when body is empty',
  })
  logout(@CurrentUser() user: AuthUser, @Body() dto: AdminLogoutDto) {
    return this.authService.logout(user, dto.refreshToken);
  }

  @Get('me')
  @AdminAuth()
  @ApiOperation({ summary: 'Logged-in admin' })
  me(@CurrentUser('sub') adminId: string) {
    return this.authService.me(adminId);
  }

  @RateLimit(RATE_LIMITS.ADMIN_CHANGE_PASSWORD)
  @Post('change-password')
  @HttpCode(200)
  @AdminAuth()
  @ApiOperation({ summary: 'Change the logged-in admin password' })
  changePassword(
    @CurrentUser('sub') adminId: string,
    @Body() dto: AdminChangePasswordDto,
  ) {
    return this.authService.changePassword(
      adminId,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
