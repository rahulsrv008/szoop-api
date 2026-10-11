import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HomeCategory, HomePopularItem } from 'src/database/entities';
import { normalizeHomeScreen } from 'src/common/home-screen';
import {
  SETTING_KEYS,
  SettingsService,
} from 'src/common/services/settings.service';

@Injectable()
export class CustomerHomeService {
  constructor(
    @InjectRepository(HomeCategory)
    private readonly categoryRepo: Repository<HomeCategory>,
    @InjectRepository(HomePopularItem)
    private readonly popularRepo: Repository<HomePopularItem>,
    private readonly settings: SettingsService,
  ) {}

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

    return {
      taxPercent,
      screen: normalizeHomeScreen(homeScreen),
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
