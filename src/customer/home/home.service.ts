import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { HomeCategory, HomePopularItem } from 'src/database/entities';
import { normalizeHomeScreen, resolveHomeTabs } from 'src/common/home-screen';
import {
  SETTING_KEYS,
  SettingsService,
} from 'src/common/services/settings.service';

/** Mirrors the columns in sql/bathroom_cleaning.sql, so the home queries never miss them. */
const SCHEMA_SQL = `
ALTER TABLE home_categories ADD COLUMN IF NOT EXISTS exclusions JSONB NOT NULL DEFAULT '[]';
ALTER TABLE home_category_options ADD COLUMN IF NOT EXISTS exclusions JSONB NOT NULL DEFAULT '[]';
`;

@Injectable()
export class CustomerHomeService implements OnModuleInit {
  private readonly logger = new Logger(CustomerHomeService.name);

  constructor(
    @InjectRepository(HomeCategory)
    private readonly categoryRepo: Repository<HomeCategory>,
    @InjectRepository(HomePopularItem)
    private readonly popularRepo: Repository<HomePopularItem>,
    private readonly settings: SettingsService,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    try {
      await this.dataSource.query(SCHEMA_SQL);
    } catch (err) {
      this.logger.error('Failed to ensure home content exclusions columns', err as Error);
    }
  }

  async home() {
    const [
      categories,
      popular,
      taxPercent,
      morningPerPerson,
      eveningPerPerson,
      bothPerPerson,
      extraPersonDiscountPercent,
      cleaningMonthly,
      homeScreen,
    ] = await Promise.all([
      this.categoryRepo.find({
        where: { isActive: true },
        relations: ['options'],
        order: {
          sortOrder: 'ASC',
          createdAt: 'ASC',
          options: { sortOrder: 'ASC', createdAt: 'ASC' },
        },
      }),
      this.popularRepo.find({
        where: { isActive: true },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
      this.settings.getNumber(SETTING_KEYS.BOOKING_TAX_PERCENT, 0),
      this.settings.getNumber(SETTING_KEYS.COOK_MORNING_PER_PERSON, 1200),
      this.settings.getNumber(SETTING_KEYS.COOK_EVENING_PER_PERSON, 1200),
      this.settings.getNumber(SETTING_KEYS.COOK_BOTH_PER_PERSON, 2000),
      this.settings.getNumber(SETTING_KEYS.COOK_EXTRA_PERSON_DISCOUNT_PERCENT, 10),
      this.settings.getNumber(SETTING_KEYS.COOK_CLEANING_MONTHLY, 1200),
      this.settings.get(SETTING_KEYS.CUSTOMER_HOME_SCREEN, null),
    ]);

    const screen = normalizeHomeScreen(homeScreen);
    const tabs = resolveHomeTabs(screen.tabs, categories);

    return {
      taxPercent,
      screen: { ...screen, tabs },
      tabs,
      cookPricing: {
        morningPerPerson,
        eveningPerPerson,
        bothPerPerson,
        extraPersonDiscountPercent,
        cleaningMonthly,
      },
      categories: categories.map((category) => ({
        id: category.id,
        title: category.title,
        subtitle: category.subtitle,
        badge: category.badge,
        imageUrl: category.imageUrl,
        tileColor: category.tileColor,
        layout: category.layout,
        actionType: category.actionType,
        popupTitle: category.popupTitle,
        highlights: category.highlights ?? [],
        exclusions: category.exclusions ?? [],
        pricing: category.pricing ?? [],
        options: (category.options ?? [])
          .filter((option) => option.isActive)
          .map((option) => ({
            id: option.id,
            title: option.title,
            subtitle: option.subtitle,
            priceLabel: option.priceLabel,
            badge: option.badge,
            imageUrl: option.imageUrl,
            popupTitle: option.popupTitle,
            highlights: option.highlights ?? [],
            exclusions: option.exclusions ?? [],
            pricing: option.pricing ?? [],
          })),
      })),
      popular: popular.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        imageUrl: item.imageUrl,
        priceLabel: item.priceLabel,
        badge: item.badge,
        rating: item.rating === null ? null : Number(item.rating),
        categoryId: item.categoryId,
        optionId: item.optionId,
      })),
    };
  }
}
