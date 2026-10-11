import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export const BOOKING_STATUSES = [
  'finding',
  'paid',
  'accepted',
  'arriving',
  'ongoing',
  'completed',
  'cancelled',
  'expired',
];

export const PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
  'VOIDED',
];

/** `search` is inherited from PaginationQueryDto and matches bookingNumber. */
export class ListAdminBookingsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BOOKING_STATUSES })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: string;

  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  paymentStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'bookingDate from',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'bookingDate to' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
