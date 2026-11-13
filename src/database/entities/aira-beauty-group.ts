import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type AiraSegment = 'women' | 'men' | 'bridal' | 'spa';

/** A tile on the Aira Luxury home screen (Waxing Studio, Hair Studio, …). */
@Entity('aira_beauty_groups')
export class AiraBeautyGroup {
  /** Stable slug the app routes by, e.g. 'waxing'. */
  @PrimaryColumn({ type: 'varchar', length: 40 })
  id: string;

  @Column({ type: 'varchar', length: 80 })
  title: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  blurb: string | null;

  /** Ionicons name. */
  @Column({ type: 'varchar', length: 40, default: 'sparkles' })
  icon: string;

  @Column({ type: 'varchar', length: 20, default: 'women' })
  segment: AiraSegment;

  /** URL or data URL; when empty the app uses its bundled photo for this group. */
  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
