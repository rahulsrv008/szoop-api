import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  HomeCategory,
  HomeCategoryOption,
  HomeHighlight,
  HomePopularItem,
  HomePricingTier,
} from 'src/database/entities';
import { normalizeHomeScreen } from 'src/common/home-screen';
import { AuditService } from 'src/common/services/audit.service';
import {
  SETTING_KEYS,
  SettingsService,
} from 'src/common/services/settings.service';
import {
  CreateHomeCategoryDto,
  CreateHomeCategoryOptionDto,
  CreateHomePopularItemDto,
  HomeHighlightDto,
  HomePricingTierDto,
  UpdateHomeCategoryDto,
  UpdateHomeCategoryOptionDto,
  UpdateHomePopularItemDto,
  UpdateHomeScreenDto,
} from './dto/home-content.dto';

type Nullable<T> = { [K in keyof T]: T[K] | null | undefined };

function cleanPricing(list?: HomePricingTierDto[]): HomePricingTier[] {
  return (list ?? [])
    .map((tier) => ({
      label: tier.label.trim(),
      subtitle: tier.subtitle?.trim() || null,
      minutes: tier.minutes ?? null,
      startTime: tier.startTime || null,
      price: Math.round(Number(tier.price) * 100) / 100,
    }))
    .filter((tier) => tier.label && tier.price > 0);
}

function cleanHighlights(list?: HomeHighlightDto[]): HomeHighlight[] {
  return (list ?? [])
    .map((item) => ({
      text: item.text.trim(),
      icon: item.icon?.trim() || null,
    }))
    .filter((item) => item.text);
}

/** Copies only the keys present on the DTO so PATCH keeps untouched fields. */
function assignDefined<T extends object>(target: T, patch: Nullable<Partial<T>>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (target as Record<string, unknown>)[key] = value;
  }
}

@Injectable()
export class AdminHomeContentService {
  constructor(
    @InjectRepository(HomeCategory)
    private readonly categoryRepo: Repository<HomeCategory>,
    @InjectRepository(HomeCategoryOption)
    private readonly optionRepo: Repository<HomeCategoryOption>,
    @InjectRepository(HomePopularItem)
    private readonly popularRepo: Repository<HomePopularItem>,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async getScreen() {
    const stored = await this.settings.get(
      SETTING_KEYS.CUSTOMER_HOME_SCREEN,
      null,
    );
    return normalizeHomeScreen(stored);
  }

  async updateScreen(adminId: string, dto: UpdateHomeScreenDto) {
    const screen = normalizeHomeScreen(dto);
    await this.settings.set(SETTING_KEYS.CUSTOMER_HOME_SCREEN, screen, {
      description: 'Customer app front page: offers, trust, how it works, and the bottom call to action.',
      updatedBy: adminId,
    });
    await this.record(adminId, 'HOME_SCREEN_UPDATED', 'system_settings', null);
    return screen;
  }

  listCategories() {
    return this.categoryRepo.find({
      relations: ['options'],
      order: {
        sortOrder: 'ASC',
        createdAt: 'ASC',
        options: { sortOrder: 'ASC', createdAt: 'ASC' },
      },
    });
  }

  async createCategory(adminId: string, dto: CreateHomeCategoryDto) {
    const category = await this.categoryRepo.save(
      this.categoryRepo.create({
        title: dto.title.trim(),
        subtitle: dto.subtitle ?? null,
        badge: dto.badge ?? null,
        imageUrl: dto.imageUrl ?? null,
        tileColor: dto.tileColor ?? null,
        layout: dto.layout ?? 'HALF',
        actionType: dto.actionType ?? 'POPUP',
        popupTitle: dto.popupTitle ?? null,
        highlights: cleanHighlights(dto.highlights),
        pricing: cleanPricing(dto.pricing),
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      }),
    );
    await this.record(adminId, 'HOME_CATEGORY_CREATED', 'home_categories', category.id);
    return category;
  }

  async updateCategory(adminId: string, id: string, dto: UpdateHomeCategoryDto) {
    const category = await this.requireCategory(id);
    const { highlights, pricing, title, ...rest } = dto;
    assignDefined(category, rest);
    if (title !== undefined) category.title = title.trim();
    if (highlights !== undefined) category.highlights = cleanHighlights(highlights);
    if (pricing !== undefined) category.pricing = cleanPricing(pricing);
    await this.categoryRepo.save(category);
    await this.record(adminId, 'HOME_CATEGORY_UPDATED', 'home_categories', id);
    return category;
  }

  async removeCategory(adminId: string, id: string) {
    await this.requireCategory(id);
    await this.categoryRepo.delete({ id });
    await this.record(adminId, 'HOME_CATEGORY_DELETED', 'home_categories', id);
    return { id, deleted: true };
  }

  async createOption(
    adminId: string,
    categoryId: string,
    dto: CreateHomeCategoryOptionDto,
  ) {
    await this.requireCategory(categoryId);
    const option = await this.optionRepo.save(
      this.optionRepo.create({
        categoryId,
        title: dto.title.trim(),
        subtitle: dto.subtitle ?? null,
        priceLabel: dto.priceLabel ?? null,
        badge: dto.badge ?? null,
        imageUrl: dto.imageUrl ?? null,
        popupTitle: dto.popupTitle ?? null,
        highlights: cleanHighlights(dto.highlights),
        pricing: cleanPricing(dto.pricing),
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      }),
    );
    await this.record(adminId, 'HOME_OPTION_CREATED', 'home_category_options', option.id);
    return option;
  }

  async updateOption(adminId: string, id: string, dto: UpdateHomeCategoryOptionDto) {
    const option = await this.requireOption(id);
    const { highlights, pricing, title, ...rest } = dto;
    assignDefined(option, rest);
    if (title !== undefined) option.title = title.trim();
    if (highlights !== undefined) option.highlights = cleanHighlights(highlights);
    if (pricing !== undefined) option.pricing = cleanPricing(pricing);
    await this.optionRepo.save(option);
    await this.record(adminId, 'HOME_OPTION_UPDATED', 'home_category_options', id);
    return option;
  }

  async removeOption(adminId: string, id: string) {
    await this.requireOption(id);
    await this.optionRepo.delete({ id });
    await this.record(adminId, 'HOME_OPTION_DELETED', 'home_category_options', id);
    return { id, deleted: true };
  }

  listPopular() {
    return this.popularRepo.find({
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async createPopular(adminId: string, dto: CreateHomePopularItemDto) {
    await this.validateLinks(dto.categoryId, dto.optionId);
    const item = await this.popularRepo.save(
      this.popularRepo.create({
        title: dto.title.trim(),
        subtitle: dto.subtitle ?? null,
        imageUrl: dto.imageUrl ?? null,
        priceLabel: dto.priceLabel ?? null,
        badge: dto.badge ?? null,
        rating: dto.rating == null ? null : String(dto.rating),
        categoryId: dto.categoryId ?? null,
        optionId: dto.optionId ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      }),
    );
    await this.record(adminId, 'HOME_POPULAR_CREATED', 'home_popular_items', item.id);
    return item;
  }

  async updatePopular(adminId: string, id: string, dto: UpdateHomePopularItemDto) {
    const item = await this.popularRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Popular item not found');
    await this.validateLinks(dto.categoryId, dto.optionId);

    const { rating, title, ...rest } = dto;
    assignDefined(item, rest);
    if (title !== undefined) item.title = title.trim();
    if (rating !== undefined) item.rating = rating === null ? null : String(rating);
    await this.popularRepo.save(item);
    await this.record(adminId, 'HOME_POPULAR_UPDATED', 'home_popular_items', id);
    return item;
  }

  async removePopular(adminId: string, id: string) {
    const result = await this.popularRepo.delete({ id });
    if (!result.affected) throw new NotFoundException('Popular item not found');
    await this.record(adminId, 'HOME_POPULAR_DELETED', 'home_popular_items', id);
    return { id, deleted: true };
  }

  private async validateLinks(categoryId?: string | null, optionId?: string | null) {
    if (categoryId) await this.requireCategory(categoryId);
    if (optionId) {
      const option = await this.requireOption(optionId);
      if (categoryId && option.categoryId !== categoryId) {
        throw new BadRequestException('Option does not belong to the selected category');
      }
    }
  }

  private async requireCategory(id: string) {
    const category = await this.categoryRepo.findOne({ where: { id } });
    if (!category) throw new NotFoundException('Home category not found');
    return category;
  }

  private async requireOption(id: string) {
    const option = await this.optionRepo.findOne({ where: { id } });
    if (!option) throw new NotFoundException('Category option not found');
    return option;
  }

  private record(adminId: string, action: string, entityType: string, entityId: string | null) {
    return this.audit.record({
      userId: adminId,
      action,
      entityType,
      entityId,
      oldData: null,
      newData: null,
    });
  }
}
