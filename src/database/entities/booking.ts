import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  OneToOne,
  Index,
} from 'typeorm';
import { Customer } from './customer';
import { Agent } from './agent';
import { CustomerAddress } from './customer-address';
import { ServiceArea } from './service-area';
import { BookingItem } from './booking-item';
import { BookingStatusHistory } from './booking-status-history';
import { Payment } from './payment';
import { AgentLocation } from './agent-location';
import { Rating } from './rating';

/**
 * Booking state machine (CleanIt STG):
 * finding → paid → accepted → arriving → ongoing → completed
 * cancelled can happen before start
 * expired: no agent was assigned before the slot passed (system-set, never by the customer)
 */
export type BookingStatus =
  | 'finding'
  | 'paid'
  | 'accepted'
  | 'arriving'
  | 'ongoing'
  | 'completed'
  | 'cancelled'
  | 'expired';

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_number', type: 'varchar', length: 30, unique: true })
  bookingNumber: string;

  @Index('idx_bookings_customer_id')
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, (customer) => customer.bookings)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Index('idx_bookings_agent_id')
  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId: string | null;

  @ManyToOne(() => Agent, (agent) => agent.bookings, { nullable: true })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent | null;

  @Column({ name: 'address_id', type: 'uuid', nullable: true })
  addressId: string | null;

  @ManyToOne(() => CustomerAddress, (address) => address.bookings, {
    nullable: true,
  })
  @JoinColumn({ name: 'address_id' })
  address: CustomerAddress | null;

  @Column({ name: 'service_area_id', type: 'uuid', nullable: true })
  serviceAreaId: string | null;

  @ManyToOne(() => ServiceArea, (area) => area.bookings, { nullable: true })
  @JoinColumn({ name: 'service_area_id' })
  serviceArea: ServiceArea | null;

  @Index('idx_bookings_date')
  @Column({ name: 'booking_date', type: 'date' })
  bookingDate: string;

  @Column({ name: 'start_time', type: 'time' })
  startTime: string;

  @Column({ name: 'end_time', type: 'time', nullable: true })
  endTime: string | null;

  @Column({ name: 'duration_minutes', type: 'int', default: 60 })
  durationMinutes: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  subtotal: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  tax: string;

  @Column({ name: 'total_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalAmount: string;

  @Column({ name: 'payment_status', type: 'varchar', length: 30, default: 'PENDING' })
  paymentStatus: string;

  @Index('idx_bookings_status')
  @Column({ type: 'varchar', length: 30, default: 'finding' })
  status: BookingStatus;

  @Column({ name: 'start_otp', type: 'varchar', length: 20, nullable: true })
  startOtp: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Set for bookings made from customer home plans instead of catalog services. */
  @Column({ name: 'plan_type', type: 'varchar', length: 20, nullable: true })
  planType: 'HOURLY' | 'MONTHLY' | null;

  @Column({ name: 'plan_title', type: 'varchar', length: 200, nullable: true })
  planTitle: string | null;

  @Column({ name: 'home_category_id', type: 'uuid', nullable: true })
  homeCategoryId: string | null;

  @Column({ name: 'home_option_id', type: 'uuid', nullable: true })
  homeOptionId: string | null;

  @OneToMany(() => BookingItem, (item) => item.booking)
  items: BookingItem[];

  @OneToMany(() => BookingStatusHistory, (row) => row.booking)
  statusHistory: BookingStatusHistory[];

  @OneToOne(() => Payment, (payment) => payment.booking)
  payment: Payment | null;

  @OneToMany(() => AgentLocation, (ping) => ping.booking)
  locations: AgentLocation[];

  @OneToMany(() => Rating, (rating) => rating.booking)
  ratings: Rating[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
