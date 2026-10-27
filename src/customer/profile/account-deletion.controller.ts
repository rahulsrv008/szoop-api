import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';
import { RequestAccountDeletionDto } from './dto/request-account-deletion.dto';
import { CustomerProfileService } from './profile.service';

@ApiTags('customer')
@Controller(ROUTES.CUSTOMER.ACCOUNT_DELETION)
export class CustomerAccountDeletionController {
  constructor(private readonly profileService: CustomerProfileService) {}

  @Post()
  @HttpCode(200)
  @RateLimit(RATE_LIMITS.ACCOUNT_DELETION)
  @ApiOperation({
    summary: 'Public Szoop account-deletion request: ticket + block, data kept',
  })
  request(@Body() dto: RequestAccountDeletionDto) {
    return this.profileService.requestDeletion(dto);
  }
}
