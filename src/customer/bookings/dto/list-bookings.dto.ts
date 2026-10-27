import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { DateRangeQueryDto } from 'src/common/dto/date-range.dto';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { BookingStatus } from 'src/database/entities';

const BOOKING_STATUSES: BookingStatus[] = [
  'finding',
  'paid',
  'accepted',
  'arriving',
  'ongoing',
  'completed',
  'cancelled',
  'expired',
];

export class ListCustomerBookingsQueryDto extends IntersectionType(
  PaginationQueryDto,
  DateRangeQueryDto,
) {
  @ApiPropertyOptional({ enum: BOOKING_STATUSES })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;
}
