import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteAgentBookingDto {
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
