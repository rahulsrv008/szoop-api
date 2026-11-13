import { Controller, Get, Headers, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { AdminPaymentsService } from './payments.service';
import { ListAdminPaymentsDto } from './dto/list-payments.dto';
import { clientAppCode } from 'src/common/types/client-app';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.PAYMENTS)
export class AdminPaymentsController {
  constructor(private readonly paymentsService: AdminPaymentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List payments with collected/pending/refunded totals',
  })
  list(
    @Query() query: ListAdminPaymentsDto,
    @Headers('x-client-app') app?: string,
  ) {
    return this.paymentsService.list(query, clientAppCode(app));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Payment detail with booking, customer and gateway transactions',
  })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-client-app') app?: string,
  ) {
    return this.paymentsService.detail(id, clientAppCode(app));
  }
}
