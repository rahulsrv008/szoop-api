import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Books a home plan: On Demand (category + duration) or a monthly option (option + shift). */
export class CreatePlanBookingDto {
  @ApiProperty({ description: 'Home category being booked' })
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional({ description: 'Option inside the category (monthly plans)' })
  @IsOptional()
  @IsUUID()
  optionId?: string;

  @ApiProperty({ description: 'Index of the chosen pricing tier', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tierIndex: number;

  @ApiProperty({ description: 'One of the customer own addresses' })
  @IsUUID()
  addressId: string;

  @ApiPropertyOptional({
    description: 'Scheduled day; omit for On Demand "now". Monthly plans start on this day.',
    example: '2026-09-27',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'bookingDate must be YYYY-MM-DD' })
  bookingDate?: string;

  @ApiPropertyOptional({ description: 'Scheduled On Demand start (24h)', example: '10:30' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @ApiPropertyOptional({
    description: 'People the cook will serve. First person is full price; each extra person is discounted.',
    example: 2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  personCount?: number;

  @ApiPropertyOptional({
    description: 'Cook plan length in days: 3 (free trial), 7, 14, 21 or 28',
    example: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  durationDays?: number;

  @ApiPropertyOptional({ example: 'SZOOP30' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  couponCode?: string;

  @ApiPropertyOptional({ example: 'Ring the bell twice' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
