import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { AuditService } from 'src/common/services/audit.service';
import { SettingsService } from 'src/common/services/settings.service';
import { UpdateAdminSettingDto } from './dto/update-setting.dto';
import { BulkUpdateAdminSettingsDto } from './dto/bulk-update-settings.dto';

/** Thin admin wrapper around the shared SettingsService. */
@Injectable()
export class AdminSettingsService {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly settingRepo: Repository<SystemSetting>,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly access: AdminAccessService,
  ) {}

  async list() {
    this.access.assertSuperAdmin();
    const rows = await this.settings.list();
    return { items: rows.map((row) => this.toResponse(row)) };
  }

  async get(key: string) {
    this.access.assertSuperAdmin();
    const row = await this.settingRepo.findOne({
      where: { settingKey: key },
    });
    if (!row) throw new NotFoundException(`Unknown setting: ${key}`);
    return this.toResponse(row);
  }

  async set(adminId: string, key: string, dto: UpdateAdminSettingDto) {
    this.access.assertSuperAdmin();
    const existing = await this.settingRepo.findOne({
      where: { settingKey: key },
    });

    const saved = await this.settings.set(key, dto.value, {
      description: dto.description,
      updatedBy: adminId,
    });

    await this.audit.record({
      userId: adminId,
      action: 'SETTING_UPDATED',
      entityType: 'system_settings',
      entityId: saved.id,
      oldData: existing
        ? { settingKey: key, settingValue: existing.settingValue }
        : null,
      newData: { settingKey: key, settingValue: saved.settingValue },
    });

    return this.toResponse(saved);
  }

  /** One audit entry carries the whole diff of a bulk edit. */
  async bulkSet(adminId: string, dto: BulkUpdateAdminSettingsDto) {
    this.access.assertSuperAdmin();
    const keys = dto.settings.map((entry) => entry.key);
    const existingRows = await this.settings.list();
    const existingByKey = new Map(
      existingRows.map((row) => [row.settingKey, row.settingValue]),
    );

    const changes: Array<{
      key: string;
      oldValue: unknown;
      newValue: unknown;
    }> = [];
    const items: ReturnType<AdminSettingsService['toResponse']>[] = [];

    for (const entry of dto.settings) {
      const saved = await this.settings.set(entry.key, entry.value, {
        description: entry.description,
        updatedBy: adminId,
      });
      changes.push({
        key: entry.key,
        oldValue: existingByKey.get(entry.key) ?? null,
        newValue: saved.settingValue,
      });
      items.push(this.toResponse(saved));
    }

    await this.audit.record({
      userId: adminId,
      action: 'SETTINGS_BULK_UPDATED',
      entityType: 'system_settings',
      entityId: null,
      oldData: {
        settings: changes.map(({ key, oldValue }) => ({
          key,
          value: oldValue,
        })),
      },
      newData: {
        settings: changes.map(({ key, newValue }) => ({
          key,
          value: newValue,
        })),
      },
    });

    return { updated: keys.length, items };
  }

  private toResponse(row: SystemSetting) {
    return {
      settingKey: row.settingKey,
      settingValue: row.settingValue,
      description: row.description,
      updatedAt: row.updatedAt,
    };
  }
}
