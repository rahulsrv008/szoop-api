import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PINCODE_REGEX } from 'src/common/utils/validation';

export class SaveAgentAddressDto {
  @ApiProperty({ example: 'House 12, Devipura 1' })
  @IsString()
  @MaxLength(255)
  addressLine1: string;

  @ApiPropertyOptional({ example: 'Devipura 1' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locality?: string;

  @ApiProperty({ example: 'Bulandshahr' })
  @IsString()
  @MaxLength(120)
  city: string;

  @ApiPropertyOptional({ example: 'Uttar Pradesh' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @ApiPropertyOptional({ example: '203001' })
  @IsOptional()
  @Matches(PINCODE_REGEX, { message: 'Enter a valid 6-digit PIN code' })
  pincode?: string;

  @ApiPropertyOptional({ example: 28.41191 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 77.85405 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}
