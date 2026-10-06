import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AgentAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AuthUser } from 'src/common/types/auth.types';
import { AgentAuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';

@ApiTags('agent')
@Controller(ROUTES.AGENT.AUTH)
export class AgentAuthController {
  constructor(private readonly authService: AgentAuthService) {}

  @RateLimit(RATE_LIMITS.OTP_SEND)
  @Post('send-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send login OTP to an agent mobile number' })
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.mobile);
  }

  @RateLimit(RATE_LIMITS.OTP_SEND)
  @Post('resend-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend the login OTP (rate limited)' })
  resendOtp(@Body() dto: SendOtpDto) {
    return this.authService.resendOtp(dto.mobile);
  }

  @RateLimit(RATE_LIMITS.OTP_VERIFY)
  @Post('verify-otp')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify OTP, create the agent on first login, issue tokens',
  })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.mobile, dto.otp);
  }

  @Post('refresh-token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a refresh token for a new session' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  @AgentAuth()
  @ApiOperation({
    summary: 'Revoke one session, or all sessions when body is empty',
  })
  logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto) {
    return this.authService.logout(user, dto.refreshToken);
  }

  @Get('me')
  @AgentAuth()
  @ApiOperation({ summary: 'Logged-in agent' })
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user);
  }
}
