import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';
import { RequestAccountDeletionDto } from './dto/request-account-deletion.dto';
import { SendOtpDto } from 'src/customer/auth/dto/send-otp.dto';
import { CustomerProfileService } from './profile.service';
import { clientAppCode } from 'src/common/types/client-app';

@ApiTags('customer')
@Controller(ROUTES.CUSTOMER.ACCOUNT_DELETION)
export class CustomerAccountDeletionController {
  constructor(private readonly profileService: CustomerProfileService) {}

  @RateLimit(RATE_LIMITS.OTP_SEND)
  @Post('send-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send an OTP to verify an account-deletion request' })
  sendOtp(
    @Body() dto: SendOtpDto,
    @Headers('x-client-app') app?: string,
  ) {
    return this.profileService.sendDeletionOtp(
      dto.mobile,
      clientAppCode(app),
      dto.channel,
    );
  }

  @Post()
  @HttpCode(200)
  @RateLimit(RATE_LIMITS.ACCOUNT_DELETION)
  @ApiOperation({
    summary: 'Verify the customer phone and request account deletion',
  })
  request(
    @Body() dto: RequestAccountDeletionDto,
    @Headers('x-client-app') app?: string,
  ) {
    return this.profileService.requestDeletion(dto, clientAppCode(app));
  }
}
