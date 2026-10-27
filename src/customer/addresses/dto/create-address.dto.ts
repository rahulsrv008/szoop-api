import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PINCODE_REGEX } from 'src/common/utils/validation';

export class CreateCustomerAddressDto {
  @ApiProperty({ example: 'B-704, Lodha Amara' })
  @IsString()
  @MaxLength(500)
  addressLine1: string;

  @ApiPropertyOptional({ example: 'Kolshet Road' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine2?: string;

  @ApiPropertyOptional({ example: 'Opposite Viviana Mall' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  landmark?: string;

  @ApiPropertyOptional({ example: 'Thane' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'Maharashtra' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional({ example: '400607' })
  @IsOptional()
  @Matches(PINCODE_REGEX, { message: 'Enter a valid 6-digit PIN code' })
  pincode?: string;

  @ApiPropertyOptional({ example: 19.2183 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 72.9781 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ enum: ['HOME', 'WORK', 'OTHER'] })
  @IsOptional()
  @IsIn(['HOME', 'WORK', 'OTHER'])
  addressType?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Makes this the only default address',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isDefault?: boolean;
}
