import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { MOBILE_MESSAGE, MOBILE_REGEX } from 'src/common/utils/validation';

export class RequestAccountDeletionDto {
  @ApiProperty({ example: '9876543210' })
  @IsString()
  @Matches(MOBILE_REGEX, { message: MOBILE_MESSAGE })
  mobile: string;

  @ApiPropertyOptional({ example: 'Rahul' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'hello@szoop.in' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
