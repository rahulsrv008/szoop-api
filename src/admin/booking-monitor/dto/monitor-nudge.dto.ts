import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class MonitorNudgeDto {
  @ApiProperty({ description: 'agents.id' })
  @IsUUID()
  agentId: string;

  @ApiPropertyOptional({
    description:
      'The job the nudge is about. A zone admin can nudge an agent from another zone who holds a job in theirs.',
  })
  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @ApiProperty({ example: 'Time to head out' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Booking CLT-2610-0107 starts at 1:13 PM. Tap "I\'m on my way" as soon as you leave.' })
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  message: string;
}
