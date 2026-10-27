import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export const PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
  'VOIDED',
];

/** `search` is inherited from PaginationQueryDto and matches bookingNumber. */
export class ListAdminPaymentsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  paymentStatus?: string;

  @ApiPropertyOptional({ example: 'UPI', description: 'UPI | CARD | NETBANKING | WALLET | RAZORPAY' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'createdAt from' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'createdAt to' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
