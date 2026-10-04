import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { CustomerAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CustomerBookingsService } from './bookings.service';
import { CancelCustomerBookingDto } from './dto/cancel-booking.dto';
import { CreateCustomerBookingDto } from './dto/create-booking.dto';
import { CreateBeautyBookingDto } from './dto/create-beauty-booking.dto';
import { CreatePlanBookingDto } from './dto/create-plan-booking.dto';
import { ListCustomerBookingsQueryDto } from './dto/list-bookings.dto';
import { RescheduleCustomerBookingDto } from './dto/reschedule-booking.dto';

@ApiTags('customer')
@CustomerAuth()
@Controller(ROUTES.CUSTOMER.BOOKINGS)
export class CustomerBookingsController {
  constructor(private readonly bookingsService: CustomerBookingsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a booking and its pending payment' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateCustomerBookingDto,
  ) {
    return this.bookingsService.create(userId, dto);
  }

  @Post('plan')
  @ApiOperation({
    summary: 'Book an On Demand duration or a monthly plan shift from the home screen',
  })
  createPlan(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePlanBookingDto,
  ) {
    return this.bookingsService.createPlan(userId, dto);
  }

  @Post('beauty')
  @ApiOperation({ summary: 'Book a Beauty at Home service or package' })
  createBeauty(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateBeautyBookingDto,
  ) {
    return this.bookingsService.createBeauty(userId, dto);
  }

  @Get('cook-trial')
  @ApiOperation({ summary: 'Whether this customer has already used the Healthy Cook trial' })
  cookTrial(@CurrentUser('sub') userId: string) {
    return this.bookingsService.cookTrialUsed(userId);
  }

  @Get()
  @ApiOperation({ summary: 'Booking history, newest first' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListCustomerBookingsQueryDto,
  ) {
    return this.bookingsService.list(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full booking detail' })
  detail(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookingsService.detail(userId, id);
  }

  @Post(':id/change-cook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ask admin to change the cook on a monthly booking' })
  changeCook(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookingsService.requestCookChange(userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a booking that has not started yet' })
  cancel(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelCustomerBookingDto,
  ) {
    return this.bookingsService.cancel(userId, id, dto);
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move a booking to another date and time' })
  reschedule(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleCustomerBookingDto,
  ) {
    return this.bookingsService.reschedule(userId, id, dto);
  }

  @Get(':id/agent')
  @ApiOperation({ summary: 'Assigned agent for a booking' })
  agent(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookingsService.agent(userId, id);
  }
}
