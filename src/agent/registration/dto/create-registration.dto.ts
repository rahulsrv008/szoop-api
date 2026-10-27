import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MEDIA_REF_MESSAGE, MEDIA_REF_REGEX } from 'src/common/utils/validation';

export class CreateAgentRegistrationDto {
  @ApiProperty({ example: 'Rahul' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiPropertyOptional({ example: 'Srivastav' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'OTHER'] })
  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: string;

  @ApiPropertyOptional({ example: '1995-04-18' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    description: 'Selfie from camera/gallery (data URL) or hosted image URL',
  })
  @IsOptional()
  @IsString()
  @Matches(MEDIA_REF_REGEX, { message: MEDIA_REF_MESSAGE })
  profileImage?: string;

  @ApiPropertyOptional({
    example: 'SZ26-K7M4P',
    description: "Another agent's employee ID. Case, spaces and dashes are ignored.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  referralCode?: string;
}
