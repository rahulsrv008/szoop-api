import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ValidateCustomerCouponDto {
  @ApiProperty({ example: 'SZOOP30', description: 'Coupon code to apply' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  code: string;

  @ApiProperty({ example: 499, description: 'Order subtotal before discount' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  subtotal: number;

  @ApiPropertyOptional({
    example: 'CLEANING',
    enum: ['CLEANING', 'COOKING', 'SALON'],
    required: false,
    description: 'Booking service domain',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase().trim() : value,
  )
  service?: 'CLEANING' | 'COOKING' | 'SALON';
}
