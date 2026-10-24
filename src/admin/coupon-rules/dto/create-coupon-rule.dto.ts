import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  RuleComparisonOperator,
  RuleConditionType,
  RuleServiceType,
} from 'src/database/entities';

export const RULE_SERVICE_TYPES: RuleServiceType[] = [
  'ALL',
  'CLEANING',
  'COOKING',
  'SALON',
];

export const RULE_CONDITION_TYPES: RuleConditionType[] = [
  'COMPLETED_BOOKINGS',
  'NEW_CUSTOMER',
  'INACTIVE_DAYS',
  'DAYS_SINCE_SERVICE',
];

export const RULE_OPERATORS: RuleComparisonOperator[] = [
  'EQUALS',
  'GREATER_THAN',
  'GREATER_THAN_OR_EQUAL',
  'LESS_THAN',
  'LESS_THAN_OR_EQUAL',
];

export class RuleConditionDto {
  @ApiProperty({ enum: RULE_CONDITION_TYPES })
  @IsIn(RULE_CONDITION_TYPES)
  type: RuleConditionType;

  @ApiProperty({ enum: RULE_SERVICE_TYPES, default: 'ALL' })
  @IsIn(RULE_SERVICE_TYPES)
  service: RuleServiceType;

  @ApiProperty({ enum: RULE_OPERATORS, default: 'GREATER_THAN_OR_EQUAL' })
  @IsIn(RULE_OPERATORS)
  operator: RuleComparisonOperator;

  @ApiProperty({ example: 5, description: 'Comparison threshold value' })
  @IsNumber()
  @Min(0)
  value: number;

  @ApiPropertyOptional({
    example: 90,
    description: 'Lookback window in days (null for all-time)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  windowDays?: number | null;
}

export class CreateCouponRuleDto {
  @ApiProperty({ example: 'Loyal Cleaning Customers' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ example: 'Completed Cleaning bookings >= 5' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiProperty({
    type: [String],
    enum: RULE_SERVICE_TYPES,
    default: ['ALL'],
  })
  @IsArray()
  @IsIn(RULE_SERVICE_TYPES, { each: true })
  applicableServices: RuleServiceType[];

  @ApiProperty({ enum: ['AND', 'OR'], default: 'AND' })
  @IsIn(['AND', 'OR'])
  matchType: 'AND' | 'OR';

  @ApiProperty({ type: [RuleConditionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleConditionDto)
  conditions: RuleConditionDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
