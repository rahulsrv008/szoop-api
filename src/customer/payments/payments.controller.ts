import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { CustomerAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CustomerPaymentsService } from './payments.service';
import { CreateCustomerPaymentDto } from './dto/create-payment.dto';
import { VerifyCustomerPaymentDto } from './dto/verify-payment.dto';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';

@ApiTags('customer')
@CustomerAuth()
@Controller(ROUTES.CUSTOMER.PAYMENTS)
export class CustomerPaymentsController {
  constructor(private readonly paymentsService: CustomerPaymentsService) {}

  @RateLimit(RATE_LIMITS.PAYMENT_CREATE)
  @Post('create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a gateway order for a booking' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateCustomerPaymentDto,
  ) {
    return this.paymentsService.createOrder(userId, dto);
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify the checkout callback and mark the booking paid',
  })
  verify(
    @CurrentUser('sub') userId: string,
    @Body() dto: VerifyCustomerPaymentDto,
  ) {
    return this.paymentsService.verify(userId, dto);
  }
}
