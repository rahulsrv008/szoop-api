import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coupon, CouponEligibilityRule } from 'src/database/entities';
import { AuditService } from 'src/common/services/audit.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { CreateCouponRuleDto } from './dto/create-coupon-rule.dto';
import { UpdateCouponRuleDto } from './dto/update-coupon-rule.dto';
import { ListCouponRulesDto } from './dto/list-coupon-rules.dto';

@Injectable()
export class AdminCouponRulesService {
  constructor(
    @InjectRepository(CouponEligibilityRule)
    private readonly ruleRepo: Repository<CouponEligibilityRule>,
    @InjectRepository(Coupon)
    private readonly couponRepo: Repository<Coupon>,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCouponRulesDto) {
    const { skip, take } = skipTake(query);
    const qb = this.ruleRepo.createQueryBuilder('rule');

    if (query.search?.trim()) {
      qb.andWhere('rule.name ILIKE :search OR rule.description ILIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }

    if (query.isActive !== undefined) {
      qb.andWhere('rule.isActive = :isActive', { isActive: query.isActive });
    }

    qb.orderBy('rule.createdAt', 'DESC').offset(skip).limit(take);

    const [rows, total] = await qb.getManyAndCount();

    // Attach count of coupons currently using each rule
    const ruleIds = rows.map((r) => r.id);
    let countsByRule: Record<string, number> = {};
    if (ruleIds.length > 0) {
      const counts = await this.couponRepo
        .createQueryBuilder('coupon')
        .select('coupon.eligibilityRuleId', 'ruleId')
        .addSelect('COUNT(coupon.id)', 'count')
        .where('coupon.eligibilityRuleId IN (:...ruleIds)', { ruleIds })
        .groupBy('coupon.eligibilityRuleId')
        .getRawMany();

      countsByRule = counts.reduce((acc, row) => {
        acc[row.ruleId] = Number(row.count);
        return acc;
      }, {} as Record<string, number>);
    }

    const items = rows.map((rule) => ({
      ...rule,
      linkedCouponsCount: countsByRule[rule.id] ?? 0,
    }));

    return paginated(items, total, query);
  }

  async findOne(id: string) {
    const rule = await this.ruleRepo.findOne({
      where: { id },
      relations: ['coupons'],
    });
    if (!rule) throw new NotFoundException('Coupon rule not found');
    return rule;
  }

  async create(adminId: string, dto: CreateCouponRuleDto) {
    this.validateConditions(dto.conditions);

    const rule = this.ruleRepo.create({
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      applicableServices: dto.applicableServices || ['ALL'],
      matchType: dto.matchType || 'AND',
      conditions: dto.conditions || [],
      isActive: dto.isActive !== undefined ? dto.isActive : true,
    });

    const saved = await this.ruleRepo.save(rule);

    await this.audit.record({
      userId: adminId,
      action: 'COUPON_RULE_CREATED',
      entityType: 'coupon_eligibility_rules',
      entityId: saved.id,
      oldData: null,
      newData: saved as unknown as Record<string, unknown>,
    });

    return saved;
  }

  async update(adminId: string, id: string, dto: UpdateCouponRuleDto) {
    const rule = await this.findOne(id);
    const oldData = { ...rule };

    if (dto.conditions) {
      this.validateConditions(dto.conditions);
      rule.conditions = dto.conditions;
    }

    if (dto.name !== undefined) rule.name = dto.name.trim();
    if (dto.description !== undefined) {
      rule.description = dto.description?.trim() || null;
    }
    if (dto.applicableServices !== undefined) {
      rule.applicableServices = dto.applicableServices;
    }
    if (dto.matchType !== undefined) rule.matchType = dto.matchType;
    if (dto.isActive !== undefined) rule.isActive = dto.isActive;

    const saved = await this.ruleRepo.save(rule);

    await this.audit.record({
      userId: adminId,
      action: 'COUPON_RULE_UPDATED',
      entityType: 'coupon_eligibility_rules',
      entityId: saved.id,
      oldData: oldData as unknown as Record<string, unknown>,
      newData: saved as unknown as Record<string, unknown>,
    });

    return saved;
  }

  async toggle(adminId: string, id: string) {
    const rule = await this.findOne(id);
    const oldData = { ...rule };
    rule.isActive = !rule.isActive;
    const saved = await this.ruleRepo.save(rule);

    await this.audit.record({
      userId: adminId,
      action: 'COUPON_RULE_TOGGLED',
      entityType: 'coupon_eligibility_rules',
      entityId: saved.id,
      oldData: oldData as unknown as Record<string, unknown>,
      newData: saved as unknown as Record<string, unknown>,
    });

    return saved;
  }

  async remove(adminId: string, id: string) {
    const rule = await this.findOne(id);
    const linkedCount = await this.couponRepo.count({
      where: { eligibilityRuleId: id },
    });

    if (linkedCount > 0) {
      // If linked to coupons, deactivate rather than delete to maintain historical integrity
      rule.isActive = false;
      await this.ruleRepo.save(rule);
      return {
        deleted: false,
        deactivated: true,
        reason: `Rule is linked to ${linkedCount} coupon(s), so it was deactivated instead of deleted.`,
      };
    }

    await this.ruleRepo.delete(id);

    await this.audit.record({
      userId: adminId,
      action: 'COUPON_RULE_DELETED',
      entityType: 'coupon_eligibility_rules',
      entityId: id,
      oldData: rule as unknown as Record<string, unknown>,
      newData: null,
    });

    return { deleted: true, deactivated: false, reason: null };
  }

  private validateConditions(conditions: any[]) {
    if (!Array.isArray(conditions)) {
      throw new BadRequestException('Conditions must be an array');
    }
    for (const cond of conditions) {
      if (!cond.type || !cond.service || !cond.operator || cond.value === undefined) {
        throw new BadRequestException(
          'Each condition must specify type, service, operator, and value',
        );
      }
      if (cond.value < 0) {
        throw new BadRequestException('Condition value cannot be negative');
      }
    }
  }
}
