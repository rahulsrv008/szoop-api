import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateBeautyBookingDto {
  @ApiProperty({ example: 'pkg-quick' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'serviceId is not a beauty service' })
  @MaxLength(40)
  serviceId: string;

  @ApiProperty()
  @IsUUID()
  addressId: string;

  @ApiPropertyOptional({ example: '2026-10-04' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'bookingDate must be YYYY-MM-DD' })
  bookingDate?: string;

  @ApiPropertyOptional({ example: '11:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @ApiPropertyOptional({ example: 'SZOOP30' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  couponCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
