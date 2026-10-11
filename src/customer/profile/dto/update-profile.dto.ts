import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { MEDIA_REF_MESSAGE, MEDIA_REF_REGEX } from 'src/common/utils/validation';

export class UpdateCustomerProfileDto {
  @ApiPropertyOptional({ example: 'Rahul' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Srivastav' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: 'rahul@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'OTHER'] })
  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: string;

  @ApiPropertyOptional({ example: '1995-04-18' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    description: 'Photo from camera/gallery (data URL) or hosted image URL',
  })
  @IsOptional()
  @IsString()
  @Matches(MEDIA_REF_REGEX, { message: MEDIA_REF_MESSAGE })
  profileImage?: string;
}
