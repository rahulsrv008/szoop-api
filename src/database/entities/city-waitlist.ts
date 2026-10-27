import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/** A customer who tapped "Notify me" for a city we don't serve yet. */
@Entity('city_waitlist')
@Unique('uq_city_waitlist_customer_city', ['customerId', 'cityKey'])
export class CityWaitlist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  /** Lower-cased city name, so "Agra" and "agra" land on one row. */
  @Column({ name: 'city_key', type: 'varchar', length: 100 })
  cityKey: string;

  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Column({ name: 'upcoming_city_id', type: 'uuid', nullable: true })
  upcomingCityId: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ name: 'notified_at', type: 'timestamptz', nullable: true })
  notifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
