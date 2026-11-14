import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AiraBeautyGroup, AiraBeautyItem } from 'src/database/entities';
import { SettingsService } from 'src/common/services/settings.service';
import { AIRA_MENU_SQL } from './aira-menu.schema';
import { SEED_GROUPS, SEED_ITEMS, SEED_SECTIONS } from './aira-menu.seed';
import {
  CreateAiraGroupDto,
  CreateAiraItemDto,
  UpdateAiraGroupDto,
  UpdateAiraItemDto,
} from './dto/aira-menu.dto';

/** Brand copy the admin edits under Aira → App settings (system_settings). */
const BRAND_SETTINGS = {
  enabled: ['aira_enabled', true],
  brandName: ['aira_brand_name', 'Aira Luxury'],
  tagline: ['aira_tagline', 'Luxury beauty, on your Szoop account'],
  heroTitle: ['aira_hero_title', 'Feel beautiful. Feel like you.'],
  heroCopy: ['aira_hero_copy', 'Thoughtful beauty services, wherever you feel most comfortable.'],
  supportEmail: ['aira_support_email', 'hello@szoop.in'],
} as const;

export interface BookableBeautyService {
  id: string;
  title: string;
  minutes: number;
  price: number;
  includes: string[];
}

const num = (value: string | null) => (value === null ? null : Number(value));

@Injectable()
export class AiraMenuService implements OnModuleInit {
  private readonly logger = new Logger(AiraMenuService.name);

  constructor(
    @InjectRepository(AiraBeautyGroup)
    private readonly groupRepo: Repository<AiraBeautyGroup>,
    @InjectRepository(AiraBeautyItem)
    private readonly itemRepo: Repository<AiraBeautyItem>,
    private readonly settings: SettingsService,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    try {
      await this.dataSource.query(AIRA_MENU_SQL);
      await this.seedIfEmpty();
    } catch (err) {
      this.logger.error('Failed to prepare the Aira menu tables', err as Error);
    }
  }

  /** Public menu for the Aira app: active groups and items, plus brand copy. */
  async menu() {
    const [groups, items, settings] = await Promise.all([
      this.groupRepo.find({ where: { isActive: true }, order: { sortOrder: 'ASC', title: 'ASC' } }),
      this.itemRepo.find({ where: { isActive: true }, order: { sortOrder: 'ASC', title: 'ASC' } }),
      this.brandSettings(),
    ]);
    const activeGroups = new Set(groups.map((group) => group.id));
    const visible = items.filter((item) => activeGroups.has(item.groupId));

    const sections: string[] = [];
    for (const item of visible) if (!sections.includes(item.section)) sections.push(item.section);

    return {
      settings,
      groups: groups
        .map((group) => {
          const prices = visible.filter((item) => item.groupId === group.id).map((item) => Number(item.price));
          return {
            id: group.id,
            title: group.title,
            blurb: group.blurb,
            icon: group.icon,
            segment: group.segment,
            imageUrl: group.imageUrl,
            from: prices.length ? Math.min(...prices) : null,
          };
        })
        .filter((group) => group.from !== null),
      sections,
      items: visible.map((item) => this.toItem(item)),
    };
  }

  /** The active item a beauty booking may charge for, or null. */
  async findBookable(id: string): Promise<BookableBeautyService | null> {
    const item = await this.itemRepo.findOne({ where: { id, isActive: true } });
    if (!item) return null;
    const group = await this.groupRepo.findOne({ where: { id: item.groupId, isActive: true } });
    if (!group) return null;
    return { id: item.id, title: item.title, minutes: item.minutes, price: Number(item.price), includes: item.includes ?? [] };
  }

  /** Everything, including hidden rows, for the admin panel. */
  async adminList() {
    const [groups, items] = await Promise.all([
      this.groupRepo.find({ order: { sortOrder: 'ASC', title: 'ASC' } }),
      this.itemRepo.find({ order: { sortOrder: 'ASC', title: 'ASC' } }),
    ]);
    return {
      groups: groups.map((group) => ({
        ...group,
        itemCount: items.filter((item) => item.groupId === group.id).length,
      })),
      items: items.map((item) => ({ ...this.toItem(item), sortOrder: item.sortOrder, isActive: item.isActive })),
    };
  }

  async createGroup(dto: CreateAiraGroupDto) {
    if (await this.groupRepo.exist({ where: { id: dto.id } })) {
      throw new ConflictException(`A group with id "${dto.id}" already exists`);
    }
    return this.groupRepo.save(this.groupRepo.create({ ...dto, blurb: dto.blurb ?? null, imageUrl: dto.imageUrl ?? null }));
  }

  async updateGroup(id: string, dto: UpdateAiraGroupDto) {
    const group = await this.groupRepo.findOne({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');
    Object.assign(group, dto);
    return this.groupRepo.save(group);
  }

  async deleteGroup(id: string) {
    if (await this.itemRepo.exist({ where: { groupId: id } })) {
      throw new BadRequestException('Move or delete the services in this group first');
    }
    const result = await this.groupRepo.delete({ id });
    if (!result.affected) throw new NotFoundException('Group not found');
    return { deleted: true };
  }

  async createItem(dto: CreateAiraItemDto) {
    if (await this.itemRepo.exist({ where: { id: dto.id } })) {
      throw new ConflictException(`A service with id "${dto.id}" already exists`);
    }
    await this.requireGroup(dto.groupId);
    const saved = await this.itemRepo.save(this.itemRepo.create(this.itemValues(dto)));
    return this.toItem(saved);
  }

  async updateItem(id: string, dto: UpdateAiraItemDto) {
    const item = await this.itemRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Service not found');
    if (dto.groupId) await this.requireGroup(dto.groupId);
    Object.assign(item, this.itemValues(dto));
    return this.toItem(await this.itemRepo.save(item));
  }

  /** Past bookings keep their own copy of the title and price, so removing an item is safe. */
  async deleteItem(id: string) {
    const result = await this.itemRepo.delete({ id });
    if (!result.affected) throw new NotFoundException('Service not found');
    return { deleted: true };
  }

  private async requireGroup(id: string) {
    if (!(await this.groupRepo.exist({ where: { id } }))) throw new BadRequestException(`Group "${id}" does not exist`);
  }

  private itemValues(dto: Partial<CreateAiraItemDto>): Partial<AiraBeautyItem> {
    const values: Partial<AiraBeautyItem> = {};
    const copy = ['id', 'groupId', 'kind', 'title', 'section', 'minutes', 'reviewsCount', 'badge', 'segment', 'includes', 'imageUrl', 'sortOrder', 'isActive'] as const;
    for (const key of copy) {
      if (dto[key] !== undefined) (values as Record<string, unknown>)[key] = dto[key];
    }
    if (dto.price !== undefined) values.price = dto.price.toFixed(2);
    if (dto.originalPrice !== undefined) values.originalPrice = dto.originalPrice === null ? null : dto.originalPrice.toFixed(2);
    if (dto.rating !== undefined) values.rating = dto.rating === null ? null : dto.rating.toFixed(2);
    return values;
  }

  private toItem(item: AiraBeautyItem) {
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      group: item.groupId,
      section: item.section,
      minutes: item.minutes,
      price: Number(item.price),
      originalPrice: num(item.originalPrice),
      rating: num(item.rating),
      reviewsCount: item.reviewsCount,
      badge: item.badge,
      segment: item.segment,
      includes: item.includes ?? [],
      imageUrl: item.imageUrl,
    };
  }

  private async brandSettings() {
    const entries = await Promise.all(
      Object.entries(BRAND_SETTINGS).map(async ([field, [key, fallback]]) => {
        const value = await this.settings.get<unknown>(key, fallback);
        if (typeof fallback === 'boolean') {
          return [field, value === true || value === 'true' || (value !== false && value !== 'false' && fallback)] as const;
        }
        return [field, typeof value === 'string' && value.trim() ? value.trim() : fallback] as const;
      }),
    );
    return Object.fromEntries(entries) as { enabled: boolean; brandName: string; tagline: string; heroTitle: string; heroCopy: string; supportEmail: string };
  }

  private async seedIfEmpty() {
    await this.dataSource.transaction(async (manager) => {
      // 1. Ensure all seed groups exist and have imageUrl
      for (const [index, group] of SEED_GROUPS.entries()) {
        const existing = await manager.findOne(AiraBeautyGroup, { where: { id: group.id } });
        if (!existing) {
          await manager.save(
            AiraBeautyGroup,
            manager.create(AiraBeautyGroup, { ...group, sortOrder: (index + 1) * 10 }),
          );
        } else if (!existing.imageUrl && group.imageUrl) {
          existing.imageUrl = group.imageUrl;
          await manager.save(AiraBeautyGroup, existing);
        }
      }

      // 2. Ensure all seed items exist and have imageUrl / metadata
      for (const [index, item] of SEED_ITEMS.entries()) {
        const existing = await manager.findOne(AiraBeautyItem, { where: { id: item.id } });
        if (!existing) {
          await manager.save(
            AiraBeautyItem,
            manager.create(AiraBeautyItem, {
              id: item.id,
              groupId: item.group,
              kind: item.kind,
              title: item.title,
              section: item.section,
              minutes: item.minutes,
              price: item.price.toFixed(2),
              originalPrice: item.originalPrice?.toFixed(2) ?? null,
              rating: item.rating?.toFixed(2) ?? null,
              reviewsCount: item.reviewsCount ?? null,
              badge: item.badge ?? null,
              segment: item.segment ?? null,
              includes: item.includes,
              imageUrl: item.imageUrl ?? null,
              sortOrder: (SEED_SECTIONS.indexOf(item.section) + 1) * 100 + index,
            }),
          );
        } else if (!existing.imageUrl && item.imageUrl) {
          existing.imageUrl = item.imageUrl;
          if (!existing.originalPrice && item.originalPrice) {
            existing.originalPrice = item.originalPrice.toFixed(2);
          }
          if (!existing.rating && item.rating) {
            existing.rating = item.rating.toFixed(2);
          }
          if (!existing.reviewsCount && item.reviewsCount) {
            existing.reviewsCount = item.reviewsCount;
          }
          if (!existing.badge && item.badge) {
            existing.badge = item.badge;
          }
          await manager.save(AiraBeautyItem, existing);
        }
      }
    });
    this.logger.log(`Aira menu verified: ${SEED_GROUPS.length} groups, ${SEED_ITEMS.length} items`);
  }
}
