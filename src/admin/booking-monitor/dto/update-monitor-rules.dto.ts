import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_RULE_MINUTES, MonitorRules } from '../booking-monitor.rules';

/** Any subset of the rules, in whole minutes. What's left out keeps its current value. */
export class UpdateMonitorRulesDto implements Partial<MonitorRules> {
  @ApiPropertyOptional({ example: 3, description: 'Waiting for an agent: orange after (min)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RULE_MINUTES)
  waitingOrangeMinutes?: number;

  @ApiPropertyOptional({ example: 5, description: 'Waiting for an agent: red after (min)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RULE_MINUTES)
  waitingRedMinutes?: number;

  @ApiPropertyOptional({ example: 3, description: 'Agent not on the way: orange after (min)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RULE_MINUTES)
  setOffOrangeMinutes?: number;

  @ApiPropertyOptional({ example: 5, description: 'Agent not on the way: red after (min)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RULE_MINUTES)
  setOffRedMinutes?: number;

  @ApiPropertyOptional({ example: 3, description: 'On the way, not started: orange after the expected start (min)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RULE_MINUTES)
  arrivalOrangeMinutes?: number;

  @ApiPropertyOptional({ example: 5, description: 'On the way, not started: red after the expected start (min)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RULE_MINUTES)
  arrivalRedMinutes?: number;

  @ApiPropertyOptional({ example: 10, description: 'In progress: orange after the booked end (min)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RULE_MINUTES)
  overrunOrangeMinutes?: number;

  @ApiPropertyOptional({ example: 20, description: 'In progress: red after the booked end (min)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RULE_MINUTES)
  overrunRedMinutes?: number;

  @ApiPropertyOptional({ example: 30, description: 'A plan visit\'s agent should be on the way this long before it (min); plans are not broadcast per visit' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RULE_MINUTES)
  setOffLeadMinutes?: number;

  @ApiPropertyOptional({ example: 15, description: 'A "Right now" agent should start this long after setting off (min)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RULE_MINUTES)
  instantArrivalMinutes?: number;
}
