import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import { REFERRAL_MAX_LEVELS_LIMIT } from 'src/common/referrals/referral-config';

/**
 * The whole referral program, as the admin panel's form sends it. Amounts are
 * whole rupees. `rewardTiers` has one amount per invite and `levelRewards` one
 * per level from 2 up (the service checks the lengths).
 */
export class UpdateReferralSettingsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: 3, description: 'How many people can use one code, ever' })
  @IsInt()
  @Min(1)
  @Max(100)
  maxPerAgent: number;

  @ApiProperty({ example: 3, description: 'How many levels up a reward goes (1 = direct only)' })
  @IsInt()
  @Min(1)
  @Max(REFERRAL_MAX_LEVELS_LIMIT)
  maxLevels: number;

  @ApiProperty({ example: [300, 500, 700], description: 'Level 1: one amount per invite, in the order they qualify' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(100_000, { each: true })
  rewardTiers: number[];

  @ApiProperty({ example: [100, 50], description: 'Level 2, 3, …: one amount per level' })
  @IsArray()
  @ArrayMaxSize(REFERRAL_MAX_LEVELS_LIMIT)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(100_000, { each: true })
  levelRewards: number[];

  @ApiProperty({ example: 5000, description: 'Lifetime limit per agent across all levels' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  maxEarning: number;

  @ApiProperty({ example: 5, description: 'Jobs a new agent must complete' })
  @IsInt()
  @Min(1)
  @Max(1000)
  qualifyJobs: number;

  @ApiProperty({ example: 200 })
  @IsInt()
  @Min(0)
  @Max(100_000)
  joiningBonus: number;

  @ApiProperty({ example: 10, description: 'Jobs needed for level 2+ rewards (0 = always paid)' })
  @IsInt()
  @Min(0)
  @Max(1000)
  activeMinJobs: number;

  @ApiProperty({ example: 30 })
  @IsInt()
  @Min(1)
  @Max(365)
  activeWindowDays: number;
}
