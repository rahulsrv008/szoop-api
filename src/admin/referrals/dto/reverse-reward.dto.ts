import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReverseReferralRewardDto {
  @ApiProperty({
    description: 'Shown to the agent and kept on the reward',
    example: 'Duplicate account found',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  remarks: string;
}
