import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PINCODE_REGEX } from 'src/common/utils/validation';

export class ServiceZoneAreaItemDto {
  @ApiProperty({ example: 'Sector 74' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  area: string;

  @ApiProperty({ example: '201301' })
  @Matches(PINCODE_REGEX, { message: 'Enter a valid 6-digit PIN code' })
  pincode: string;

  @ApiPropertyOptional({ type: [String], example: ['High-rise societies'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  buildingsCover?: string[];
}

export class CreateAdminServiceAreaDto {
  @ApiProperty({ example: 'Noida North Central' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ example: 'NOI_N1' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @ApiPropertyOptional({ example: 'Noida' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'NCR_EAST' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  region?: string;

  @ApiPropertyOptional({ example: 'Uttar Pradesh' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional({ example: '201301' })
  @IsOptional()
  @Matches(PINCODE_REGEX, { message: 'Enter a valid 6-digit PIN code' })
  pincode?: string;

  @ApiPropertyOptional({ example: 28.59 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 77.32 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: 3, default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  serviceRadiusKm?: number;

  @ApiPropertyOptional({ type: [ServiceZoneAreaItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceZoneAreaItemDto)
  areas?: ServiceZoneAreaItemDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
