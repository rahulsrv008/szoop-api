import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export const PAYMENT_METHODS = [
  'UPI',
  'UPI_GPAY',
  'UPI_PHONEPE',
  'UPI_PAYTM',
  'UPI_OTHER',
  'CARD',
  'NETBANKING',
  'WALLET',
  'RAZORPAY',
] as const;

export class CreateCustomerPaymentDto {
  @ApiProperty({ description: 'Booking to collect payment for' })
  @IsUUID()
  bookingId: string;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS, description: 'Method picked in the app' })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];
}
