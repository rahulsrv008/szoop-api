import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { CustomerAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { CustomerRatingsService } from './ratings.service';
import { CreateCustomerRatingDto } from './dto/create-rating.dto';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';

@ApiTags('customer')
@CustomerAuth()
@Controller(ROUTES.CUSTOMER.RATINGS)
export class CustomerRatingsController {
  constructor(private readonly ratingsService: CustomerRatingsService) {}

  @RateLimit(RATE_LIMITS.RATING)
  @Post()
  @ApiOperation({ summary: 'Rate the agent of a completed booking' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateCustomerRatingDto,
  ) {
    return this.ratingsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Ratings the customer has submitted' })
  list(@CurrentUser('sub') userId: string, @Query() query: PaginationQueryDto) {
    return this.ratingsService.list(userId, query);
  }
}
