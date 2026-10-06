import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** A city we don't serve yet, greeted by its nickname ("Taj City"). */
@Entity('upcoming_cities')
export class UpcomingCity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  city: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  nickname: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string | null;

  /** Lower-case alternate spellings / localities matched against an address's city. */
  @Column({ type: 'jsonb', default: [] })
  aliases: string[];

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ name: 'radius_km', type: 'int', default: 25 })
  radiusKm: number;

  /** Overrides the default "We'll be available soon in {nickname}" copy. */
  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
