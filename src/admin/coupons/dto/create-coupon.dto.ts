import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const DISCOUNT_TYPES = ['PERCENT', 'FLAT'];

export class CreateAdminCouponDto {
  @ApiProperty({ example: 'CLEAN100', description: 'Uppercase, unique' })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'code must be uppercase letters, digits, hyphen or underscore',
  })
  code: string;

  @ApiProperty({ enum: DISCOUNT_TYPES })
  @IsIn(DISCOUNT_TYPES)
  discountType: 'PERCENT' | 'FLAT';

  @ApiProperty({
    example: 10,
    description: 'Percentage (1..100) for PERCENT, rupees for FLAT',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue: number;

  @ApiPropertyOptional({ example: 150, description: 'Cap for PERCENT coupons' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxDiscount?: number | null;

  @ApiPropertyOptional({ example: 499 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderAmount?: number | null;

  @ApiPropertyOptional({
    example: 500,
    description: 'Total redemptions allowed',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  validFrom?: string | null;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  validUntil?: string | null;

  @ApiPropertyOptional({ example: 'Special discount for VIP customer' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @ApiPropertyOptional({ example: 1, default: 1, description: 'Redemptions allowed per customer' })
  @IsOptional()
  @IsInt()
  @Min(1)
  perCustomerLimit?: number | null;

  @ApiPropertyOptional({ example: 'b0a7...', description: 'Assign to a single customer ID' })
  @IsOptional()
  @IsString()
  customerId?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Assign to multiple customer IDs' })
  @IsOptional()
  customerIds?: string[];

  @ApiPropertyOptional({ example: 'b0a7...', description: 'Link to a Coupon Eligibility Rule ID' })
  @IsOptional()
  @IsString()
  eligibilityRuleId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
