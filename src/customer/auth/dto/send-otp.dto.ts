import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { MOBILE_MESSAGE, MOBILE_REGEX } from 'src/common/utils/validation';
import type { OtpDeliveryChannel } from 'src/common/types/otp.types';

export class SendOtpDto {
  @ApiProperty({ example: '9876543210' })
  @IsString()
  @Matches(MOBILE_REGEX, { message: MOBILE_MESSAGE })
  mobile: string;

  @ApiPropertyOptional({ enum: ['sms', 'whatsapp', 'voice'], default: 'sms' })
  @IsOptional()
  @IsIn(['sms', 'whatsapp', 'voice'])
  channel?: OtpDeliveryChannel;
}
