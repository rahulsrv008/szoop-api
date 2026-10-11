import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Customer } from './customer';
import { Booking } from './booking';
import { ServiceArea } from './service-area';

@Entity('customer_addresses')
export class CustomerAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, (customer) => customer.addresses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'address_line1', type: 'text' })
  addressLine1: string;

  @Column({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2: string | null;

  @Column({ type: 'text', nullable: true })
  landmark: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  pincode: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: string | null;

  /** H3 res-8 cell of (latitude, longitude); powers the agent job-radius lookup. */
  @Column({ name: 'h3_cell', type: 'varchar', length: 16, nullable: true })
  h3Cell: string | null;

  @Column({ name: 'service_area_id', type: 'uuid', nullable: true })
  serviceAreaId: string | null;

  @ManyToOne(() => ServiceArea, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_area_id' })
  serviceArea: ServiceArea | null;

  @Column({ name: 'address_type', type: 'varchar', length: 30, nullable: true })
  addressType: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @OneToMany(() => Booking, (booking) => booking.address)
  bookings: Booking[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
