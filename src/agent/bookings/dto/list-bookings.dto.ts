import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { BookingStatus } from 'src/database/entities';

/** `available` is the open job pool, `assigned` is this agent's own work. */
export const BOOKING_SCOPES = ['available', 'assigned', 'all'] as const;
export type BookingScope = (typeof BOOKING_SCOPES)[number];

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

export class ListAgentBookingsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BOOKING_SCOPES, default: 'assigned' })
  @IsOptional()
  @IsIn([...BOOKING_SCOPES])
  scope?: BookingScope = 'assigned';

  @ApiPropertyOptional({ enum: BOOKING_STATUSES })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'Inclusive booking date',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'Inclusive booking date',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
