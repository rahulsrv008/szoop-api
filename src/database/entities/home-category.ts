import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { HomeCategoryOption } from './home-category-option';

export type HomeTileLayout = 'HALF' | 'FULL';
/** POPUP shows highlights in a sheet, OPTIONS opens a page of sub-options, COMING_SOON is a teaser tile. */
export type HomeCategoryAction = 'POPUP' | 'OPTIONS' | 'COMING_SOON';

export interface HomeHighlight {
  text: string;
  /** Image URL / data URL, or an Ionicons name. */
  icon: string | null;
}

/** One bookable choice: a duration for hourly help, a shift for a monthly plan. */
export interface HomePricingTier {
  label: string;
  subtitle: string | null;
  /** Visit length; required for hourly tiers. */
  minutes: number | null;
  /** 'HH:MM' the visit starts; used by monthly shifts. */
  startTime: string | null;
  price: number;
}

@Entity('home_categories')
export class HomeCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  subtitle: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  badge: string | null;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({ name: 'tile_color', type: 'varchar', length: 20, nullable: true })
  tileColor: string | null;

  @Column({ type: 'varchar', length: 10, default: 'HALF' })
  layout: HomeTileLayout;

  @Column({ name: 'action_type', type: 'varchar', length: 20, default: 'POPUP' })
  actionType: HomeCategoryAction;

  @Column({ name: 'popup_title', type: 'varchar', length: 120, nullable: true })
  popupTitle: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  highlights: HomeHighlight[];

  /** What the service doesn't cover, shown in its description and at checkout. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  exclusions: string[];

  /** Durations offered when the category itself is booked (On Demand). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  pricing: HomePricingTier[];

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => HomeCategoryOption, (option) => option.category)
  options: HomeCategoryOption[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
