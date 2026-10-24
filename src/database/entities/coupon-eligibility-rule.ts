import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Coupon } from './coupon';

export type RuleServiceType = 'ALL' | 'CLEANING' | 'COOKING' | 'SALON';

export type RuleConditionType =
  | 'COMPLETED_BOOKINGS'
  | 'NEW_CUSTOMER'
  | 'INACTIVE_DAYS'
  | 'DAYS_SINCE_SERVICE';

export type RuleComparisonOperator =
  | 'EQUALS'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL';

export interface CouponRuleCondition {
  type: RuleConditionType;
  service: RuleServiceType;
  operator: RuleComparisonOperator;
  value: number;
  windowDays?: number | null;
}

@Entity('coupon_eligibility_rules')
export class CouponEligibilityRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({
    name: 'applicable_services',
    type: 'text',
    array: true,
    default: () => "'{ALL}'",
  })
  applicableServices: string[];

  @Column({ name: 'match_type', type: 'varchar', length: 10, default: 'AND' })
  matchType: 'AND' | 'OR';

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  conditions: CouponRuleCondition[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => Coupon, (coupon) => coupon.eligibilityRule)
  coupons: Coupon[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
