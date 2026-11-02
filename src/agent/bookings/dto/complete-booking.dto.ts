import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumberString, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CompleteAgentBookingDto {
  @ApiProperty({ example: '5823', description: 'End OTP the customer reads out from their app' })
  @IsNumberString()
  @Length(4, 6)
  otp: string;

  @ApiPropertyOptional({ example: 'Deep cleaned the kitchen as requested' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Pay-after-service only: the customer refused to pay. The job completes and the amount is owed in their wallet.',
  })
  @IsOptional()
  @IsBoolean()
  customerRefusedPayment?: boolean;
}
