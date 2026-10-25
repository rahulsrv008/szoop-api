import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { HomeCategory } from './home-category';
import type { HomeHighlight, HomePricingTier } from './home-category';

@Entity('home_category_options')
export class HomeCategoryOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => HomeCategory, (category) => category.options, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'category_id' })
  category: HomeCategory;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  subtitle: string | null;

  @Column({ name: 'price_label', type: 'varchar', length: 60, nullable: true })
  priceLabel: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  badge: string | null;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({ name: 'popup_title', type: 'varchar', length: 120, nullable: true })
  popupTitle: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  highlights: HomeHighlight[];

  /** What this option doesn't cover, shown in its description and at checkout. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  exclusions: string[];

  /** Shifts offered for this plan (Morning / Evening / Both). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  pricing: HomePricingTier[];

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
