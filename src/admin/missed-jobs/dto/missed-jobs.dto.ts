import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export const MISSED_JOB_REASONS = [
  'NO_ON_THE_WAY',
  'NOT_MOVING',
  'CUSTOMER_REPLACED',
  'NOT_STARTED',
  'PLAN_VISIT_MISSED',
] as const;

/** Defaults to the last 30 days. `search` matches the agent's name or mobile. */
export class AdminMissedJobAgentsDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'missed slot from (date)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'missed slot to (date)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

export class ListAdminMissedJobsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'agents.id' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ enum: MISSED_JOB_REASONS })
  @IsOptional()
  @IsIn(MISSED_JOB_REASONS)
  reason?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class WarnAgentDto {
  @ApiPropertyOptional({ description: 'What the agent reads; a standard message when left out' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
