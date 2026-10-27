import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CouponUsage } from './coupon-usage';
import { Customer } from './customer';
import { CouponCustomer } from './coupon-customer';
import { CouponEligibilityRule } from './coupon-eligibility-rule';

@Entity('coupons')
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ name: 'discount_type', type: 'varchar', length: 20 })
  discountType: string;

  @Column({ name: 'discount_value', type: 'decimal', precision: 10, scale: 2 })
  discountValue: string;

  @Column({ name: 'max_discount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  maxDiscount: string | null;

  @Column({
    name: 'min_order_amount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  minOrderAmount: string | null;

  @Column({ name: 'usage_limit', type: 'int', nullable: true })
  usageLimit: number | null;

  @Column({ name: 'used_count', type: 'int', default: 0 })
  usedCount: number;

  @Column({ name: 'per_customer_limit', type: 'int', default: 1, nullable: true })
  perCustomerLimit: number | null;

  /** If set, coupon is dedicated to this single customer */
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @ManyToOne(() => Customer, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  @Column({ name: 'eligibility_rule_id', type: 'uuid', nullable: true })
  eligibilityRuleId: string | null;

  @ManyToOne(() => CouponEligibilityRule, (rule) => rule.coupons, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'eligibility_rule_id' })
  eligibilityRule: CouponEligibilityRule | null;

  @Column({ name: 'valid_from', type: 'timestamptz', nullable: true })
  validFrom: Date | null;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => CouponUsage, (usage) => usage.coupon)
  usages: CouponUsage[];

  @OneToMany(() => CouponCustomer, (cc) => cc.coupon)
  assignedCustomers: CouponCustomer[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
