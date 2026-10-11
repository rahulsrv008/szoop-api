import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { CustomerAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { IdentityService } from 'src/common/auth/identity.service';
import { WalletService } from 'src/common/services/wallet.service';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

@ApiTags('customer')
@CustomerAuth()
@Controller(ROUTES.CUSTOMER.WALLET)
export class CustomerWalletController {
  constructor(
    private readonly identity: IdentityService,
    private readonly wallet: WalletService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Wallet balance and transactions (refunds for cancelled or expired bookings)' })
  async statement(@CurrentUser('sub') userId: string, @Query() query: PaginationQueryDto) {
    const customerId = await this.identity.requireCustomerId(userId);
    return this.wallet.statement(customerId, query);
  }
}
