import { ApiPropertyOptional } from '@nestjs/swagger';
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

/** Any of these is enough; the map pin is the most reliable. */
export class CheckServiceabilityDto {
  @ApiPropertyOptional({ example: 27.1751 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 78.0421 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: '282001' })
  @IsOptional()
  @Matches(PINCODE_REGEX, { message: 'Enter a valid 6-digit PIN code' })
  pincode?: string;

  @ApiPropertyOptional({ example: 'Agra' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
}
