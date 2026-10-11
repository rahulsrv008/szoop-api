import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from 'src/database/entities';

/** Known tunables. Admin Web edits these; services read them through here. */
export const SETTING_KEYS = {
  BOOKING_TAX_PERCENT: 'booking_tax_percent',
  AGENT_PAYOUT_PERCENT: 'agent_payout_percent',
  AGENT_FIXED_SALARY: 'agent_fixed_salary',
  AGENT_INCENTIVE_THRESHOLD: 'agent_incentive_threshold',
  AGENT_INCENTIVE_PERCENT: 'agent_incentive_percent',
  BOOKING_CANCELLATION_WINDOW_MINUTES: 'booking_cancellation_window_minutes',
  COOK_MORNING_PER_PERSON: 'cook_morning_per_person',
  COOK_EVENING_PER_PERSON: 'cook_evening_per_person',
  COOK_BOTH_PER_PERSON: 'cook_both_per_person',
  COOK_EXTRA_PERSON_DISCOUNT_PERCENT: 'cook_extra_person_discount_percent',
  COOK_CLEANING_MONTHLY: 'cook_cleaning_monthly',
  CUSTOMER_HOME_SCREEN: 'customer_home_screen',
} as const;

const CACHE_TTL_MS = 30_000;

/**
 * Resolution order: `system_settings` row → matching env var (UPPER_SNAKE of
 * the key) → the caller's fallback. Values are cached briefly so hot paths
 * like booking creation don't hit the table on every request.
 */
@Injectable()
export class SettingsService {
  private readonly cache = new Map<string, { value: unknown; at: number }>();

  constructor(
    @InjectRepository(SystemSetting)
    private readonly settingRepo: Repository<SystemSetting>,
    private readonly config: ConfigService,
  ) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value as T;
    }

    const row = await this.settingRepo.findOne({ where: { settingKey: key } });
    const envValue = this.config.get<string>(key.toUpperCase());
    const value = (row?.settingValue ?? envValue ?? fallback) as T;

    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const value = await this.get<unknown>(key, fallback);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async list() {
    return this.settingRepo.find({ order: { settingKey: 'ASC' } });
  }

  async set(
    key: string,
    value: unknown,
    options: { description?: string; updatedBy?: string } = {},
  ) {
    const existing = await this.settingRepo.findOne({
      where: { settingKey: key },
    });
    const row = existing ?? this.settingRepo.create({ settingKey: key });
    row.settingValue = value;
    if (options.description !== undefined) row.description = options.description;
    row.updatedBy = options.updatedBy ?? null;

    const saved = await this.settingRepo.save(row);
    this.cache.delete(key);
    return saved;
  }

  invalidate() {
    this.cache.clear();
  }
}
