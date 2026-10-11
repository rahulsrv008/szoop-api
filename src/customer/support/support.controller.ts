import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { CustomerAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CustomerSupportService } from './support.service';
import { CreateCustomerTicketDto } from './dto/create-ticket.dto';
import { ListCustomerTicketsQueryDto } from './dto/list-tickets.dto';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';

@ApiTags('customer')
@CustomerAuth()
@Controller(ROUTES.CUSTOMER.SUPPORT)
export class CustomerSupportController {
  constructor(private readonly supportService: CustomerSupportService) {}

  @RateLimit(RATE_LIMITS.SUPPORT_TICKET)
  @Post()
  @ApiOperation({ summary: 'Raise a support ticket' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateCustomerTicketDto,
  ) {
    return this.supportService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List own support tickets' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListCustomerTicketsQueryDto,
  ) {
    return this.supportService.list(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Support ticket detail' })
  detail(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.supportService.detail(userId, id);
  }
}
