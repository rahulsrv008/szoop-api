import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { AiraSegment } from './aira-beauty-group';

export type AiraItemKind = 'package' | 'service';

/** A bookable Aira service or package. Its price is what a beauty booking charges. */
@Entity('aira_beauty_items')
export class AiraBeautyItem {
  /** Stable slug the app books by, e.g. 'wax-rica-full-arms'. */
  @PrimaryColumn({ type: 'varchar', length: 40 })
  id: string;

  @Column({ name: 'group_id', type: 'varchar', length: 40 })
  groupId: string;

  @Column({ type: 'varchar', length: 10, default: 'service' })
  kind: AiraItemKind;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  /** Menu heading the item is listed under, e.g. 'Waxing'. */
  @Column({ type: 'varchar', length: 60 })
  section: string;

  @Column({ type: 'int' })
  minutes: number;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  price: string;

  @Column({ name: 'original_price', type: 'numeric', precision: 10, scale: 2, nullable: true })
  originalPrice: string | null;

  @Column({ type: 'numeric', precision: 3, scale: 2, nullable: true })
  rating: string | null;

  @Column({ name: 'reviews_count', type: 'int', nullable: true })
  reviewsCount: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  badge: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  segment: AiraSegment | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  includes: string[];

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
