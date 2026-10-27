import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  Agent,
  AgentEarning,
  AgentIncentive,
  SalaryRecord,
} from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { ReferralRewardsService } from 'src/common/referrals/referral-rewards.service';
import { AuditService } from 'src/common/services/audit.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import {
  SETTING_KEYS,
  SettingsService,
} from 'src/common/services/settings.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { ListAdminEarningsDto } from './dto/list-earnings.dto';
import { AdminEarningsSummaryDto } from './dto/earnings-summary.dto';
import { ListAdminIncentivesDto } from './dto/list-incentives.dto';
import { GenerateAdminIncentivesDto } from './dto/generate-incentives.dto';
import { UpdateAdminIncentiveDto } from './dto/update-incentive.dto';
import { ListAdminSalaryDto } from './dto/list-salary.dto';
import { GenerateAdminSalaryDto } from './dto/generate-salary.dto';
import { UpdateAdminSalaryDto } from './dto/update-salary.dto';

/** Defaults used when the matching system_settings row is missing. */
const DEFAULT_INCENTIVE_THRESHOLD = 15000;
const DEFAULT_INCENTIVE_PERCENT = 10;
const DEFAULT_FIXED_SALARY = 12000;

/** Money already committed to an agent is never recalculated. */
const SETTLED_STATUSES = ['APPROVED', 'PAID'];

interface EarningListRow {
  id: string;
  agentId: string;
  agentFirstName: string;
  agentLastName: string | null;
  bookingId: string | null;
  bookingNumber: string | null;
  serviceHours: string;
  revenueGenerated: string;
  earningAmount: string;
  earningDate: string | null;
  createdAt: Date;
}

function monthBounds(month: number, year: number) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

@Injectable()
export class AdminEarningsService {
  constructor(
    @InjectRepository(AgentEarning)
    private readonly earningRepo: Repository<AgentEarning>,
    @InjectRepository(AgentIncentive)
    private readonly incentiveRepo: Repository<AgentIncentive>,
    @InjectRepository(SalaryRecord)
    private readonly salaryRepo: Repository<SalaryRecord>,
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationDispatchService,
    private readonly access: AdminAccessService,
    private readonly referralRewards: ReferralRewardsService,
  ) {}

  async listEarnings(query: ListAdminEarningsDto) {
    const { skip, take } = skipTake(query);

    const rowsQb = this.applyEarningFilters(this.earningBaseQuery(), query)
      .select('earning.id', 'id')
      .addSelect('earning.agentId', 'agentId')
      .addSelect('agent.firstName', 'agentFirstName')
      .addSelect('agent.lastName', 'agentLastName')
      .addSelect('earning.bookingId', 'bookingId')
      .addSelect('booking.bookingNumber', 'bookingNumber')
      .addSelect('earning.serviceHours', 'serviceHours')
      .addSelect('earning.revenueGenerated', 'revenueGenerated')
      .addSelect('earning.earningAmount', 'earningAmount')
      .addSelect(`to_char(earning.earningDate, 'YYYY-MM-DD')`, 'earningDate')
      .addSelect('earning.createdAt', 'createdAt')
      .orderBy('earning.earningDate', 'DESC')
      .addOrderBy('earning.createdAt', 'DESC')
      .offset(skip)
      .limit(take);

    const totalsQb = this.applyEarningFilters(this.earningBaseQuery(), query)
      .select('COALESCE(SUM(earning.earningAmount), 0)', 'earnings')
      .addSelect('COALESCE(SUM(earning.revenueGenerated), 0)', 'revenue')
      .addSelect('COALESCE(SUM(earning.serviceHours), 0)', 'hours');

    const [rows, total, totals] = await Promise.all([
      rowsQb.getRawMany<EarningListRow>(),
      this.applyEarningFilters(this.earningBaseQuery(), query).getCount(),
      totalsQb.getRawOne<{
        earnings: string;
        revenue: string;
        hours: string;
      }>(),
    ]);

    const page = paginated(
      rows.map((row) => ({
        id: row.id,
        agentId: row.agentId,
        agentName: this.fullName(row.agentFirstName, row.agentLastName),
        bookingId: row.bookingId,
        bookingNumber: row.bookingNumber,
        serviceHours: Number(row.serviceHours),
        revenueGenerated: Number(row.revenueGenerated),
        earningAmount: Number(row.earningAmount),
        earningDate: row.earningDate,
        createdAt: row.createdAt,
      })),
      total,
      query,
    );

    return {
      ...page,
      totals: {
        earnings: Number(totals?.earnings ?? 0),
        revenue: Number(totals?.revenue ?? 0),
        hours: Number(totals?.hours ?? 0),
      },
    };
  }

  async summary(query: AdminEarningsSummaryDto) {
    const now = new Date();
    const month = query.month ?? now.getMonth() + 1;
    const year = query.year ?? now.getFullYear();
    const { from, to } = monthBounds(month, year);

    const rowsQb = this.earningRepo
      .createQueryBuilder('earning')
      .innerJoin('earning.agent', 'agent')
      .select('earning.agentId', 'agentId')
      .addSelect('agent.firstName', 'firstName')
      .addSelect('agent.lastName', 'lastName')
      .addSelect('COUNT(DISTINCT earning.bookingId)::int', 'completedJobs')
      .addSelect('COALESCE(SUM(earning.serviceHours), 0)', 'hours')
      .addSelect('COALESCE(SUM(earning.revenueGenerated), 0)', 'revenue')
      .addSelect('COALESCE(SUM(earning.earningAmount), 0)', 'earnings')
      .where('earning.earningDate BETWEEN :from AND :to', { from, to })
      .groupBy('earning.agentId')
      .addGroupBy('agent.firstName')
      .addGroupBy('agent.lastName')
      .orderBy('revenue', 'DESC');
    this.access.restrictAgent(rowsQb, 'agent');
    const rows = await rowsQb.getRawMany<{
        agentId: string;
        firstName: string;
        lastName: string | null;
        completedJobs: number;
        hours: string;
        revenue: string;
        earnings: string;
      }>();

    const items = rows.map((row) => ({
      agentId: row.agentId,
      name: this.fullName(row.firstName, row.lastName),
      completedJobs: Number(row.completedJobs),
      hours: Number(row.hours),
      revenueGenerated: Number(row.revenue),
      earnings: Number(row.earnings),
    }));

    return {
      month,
      year,
      range: { from, to },
      items,
      totals: {
        agents: items.length,
        completedJobs: items.reduce((sum, row) => sum + row.completedJobs, 0),
        hours: Number(
          items.reduce((sum, row) => sum + row.hours, 0).toFixed(2),
        ),
        revenueGenerated: Number(
          items.reduce((sum, row) => sum + row.revenueGenerated, 0).toFixed(2),
        ),
        earnings: Number(
          items.reduce((sum, row) => sum + row.earnings, 0).toFixed(2),
        ),
      },
    };
  }

  async listIncentives(query: ListAdminIncentivesDto) {
    const { skip, take } = skipTake(query);

    const base = () =>
      this.applyIncentiveFilters(
        this.incentiveRepo
          .createQueryBuilder('incentive')
          .innerJoin('incentive.agent', 'agent')
          .innerJoin('agent.user', 'agentUser'),
        query,
      );

    const [rows, total] = await Promise.all([
      base()
        .select('incentive.id', 'id')
        .addSelect('incentive.agentId', 'agentId')
        .addSelect('agent.firstName', 'firstName')
        .addSelect('agent.lastName', 'lastName')
        .addSelect('agentUser.mobile', 'mobile')
        .addSelect('incentive.month', 'month')
        .addSelect('incentive.year', 'year')
        .addSelect('incentive.revenueGenerated', 'revenueGenerated')
        .addSelect('incentive.thresholdAmount', 'thresholdAmount')
        .addSelect('incentive.incentiveAmount', 'incentiveAmount')
        .addSelect('incentive.status', 'status')
        .addSelect('incentive.createdAt', 'createdAt')
        .orderBy('incentive.year', 'DESC')
        .addOrderBy('incentive.month', 'DESC')
        .addOrderBy('incentive.incentiveAmount', 'DESC')
        .offset(skip)
        .limit(take)
        .getRawMany<{
          id: string;
          agentId: string;
          firstName: string;
          lastName: string | null;
          mobile: string;
          month: number;
          year: number;
          revenueGenerated: string;
          thresholdAmount: string;
          incentiveAmount: string;
          status: string;
          createdAt: Date;
        }>(),
      base().getCount(),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        agentId: row.agentId,
        agentName: this.fullName(row.firstName, row.lastName),
        agentMobile: row.mobile,
        month: Number(row.month),
        year: Number(row.year),
        revenueGenerated: Number(row.revenueGenerated),
        thresholdAmount: Number(row.thresholdAmount),
        incentiveAmount: Number(row.incentiveAmount),
        status: row.status,
        createdAt: row.createdAt,
      })),
      total,
      query,
    );
  }

  /**
   * Incentive = (revenue - threshold) * percent, per agent per month, and only
   * when the agent cleared the threshold. Rows already APPROVED or PAID are
   * left alone so a re-run cannot change settled money.
   */
  async generateIncentives(adminId: string, dto: GenerateAdminIncentivesDto) {
    const { from, to } = monthBounds(dto.month, dto.year);
    const [threshold, percent] = await Promise.all([
      this.settings.getNumber(
        SETTING_KEYS.AGENT_INCENTIVE_THRESHOLD,
        DEFAULT_INCENTIVE_THRESHOLD,
      ),
      this.settings.getNumber(
        SETTING_KEYS.AGENT_INCENTIVE_PERCENT,
        DEFAULT_INCENTIVE_PERCENT,
      ),
    ]);

    const revenueQb = this.earningRepo
      .createQueryBuilder('earning')
      .innerJoin('earning.agent', 'agent')
      .select('earning.agentId', 'agentId')
      .addSelect('COALESCE(SUM(earning.revenueGenerated), 0)', 'revenue')
      .where('earning.earningDate BETWEEN :from AND :to', { from, to })
      .groupBy('earning.agentId');
    this.access.restrictAgent(revenueQb, 'agent');
    const revenueRows = await revenueQb.getRawMany<{
      agentId: string;
      revenue: string;
    }>();

    let generated = 0;
    let updated = 0;
    let skipped = 0;
    let totalIncentive = 0;

    for (const row of revenueRows) {
      const revenue = Number(row.revenue);
      const incentiveAmount =
        revenue > threshold ? ((revenue - threshold) * percent) / 100 : 0;

      const existing = await this.incentiveRepo.findOne({
        where: { agentId: row.agentId, month: dto.month, year: dto.year },
      });

      if (existing && SETTLED_STATUSES.includes(existing.status)) {
        skipped += 1;
        totalIncentive += Number(existing.incentiveAmount);
        continue;
      }

      const record =
        existing ??
        this.incentiveRepo.create({
          agentId: row.agentId,
          month: dto.month,
          year: dto.year,
        });

      record.revenueGenerated = revenue.toFixed(2);
      record.thresholdAmount = threshold.toFixed(2);
      record.incentiveAmount = incentiveAmount.toFixed(2);
      record.status = 'PENDING';
      await this.incentiveRepo.save(record);

      if (existing) updated += 1;
      else generated += 1;
      totalIncentive += incentiveAmount;
    }

    const summary = {
      month: dto.month,
      year: dto.year,
      threshold,
      percent,
      agents: revenueRows.length,
      generated,
      updated,
      skipped,
      totalIncentive: Number(totalIncentive.toFixed(2)),
    };

    await this.audit.record({
      userId: adminId,
      action: 'INCENTIVES_GENERATED',
      entityType: 'agent_incentives',
      entityId: null,
      oldData: null,
      newData: summary,
    });

    return summary;
  }

  async updateIncentive(
    adminId: string,
    id: string,
    dto: UpdateAdminIncentiveDto,
  ) {
    const incentive = await this.incentiveRepo.findOne({ where: { id } });
    if (!incentive) throw new NotFoundException('Incentive record not found');

    const oldData = { status: incentive.status };
    incentive.status = dto.status;
    await this.incentiveRepo.save(incentive);

    if (dto.status === 'APPROVED' || dto.status === 'PAID') {
      const agent = await this.agentRepo.findOne({
        where: { id: incentive.agentId },
        select: ['id', 'userId'],
      });
      if (agent) {
        await this.notifications.toUser(agent.userId, {
          app: 'agent',
          title:
            dto.status === 'PAID' ? 'Incentive paid' : 'Incentive approved',
          message: `Your incentive of ₹${Number(incentive.incentiveAmount).toFixed(2)} for ${incentive.month}/${incentive.year} has been ${dto.status.toLowerCase()}.${
            dto.remarks ? ` ${dto.remarks}` : ''
          }`,
          type: 'earnings',
        });
      }
    }

    await this.audit.record({
      userId: adminId,
      action: 'INCENTIVE_STATUS_UPDATED',
      entityType: 'agent_incentives',
      entityId: incentive.id,
      oldData,
      newData: { status: incentive.status, remarks: dto.remarks ?? null },
    });

    return this.toIncentiveResponse(incentive);
  }

  async listSalary(query: ListAdminSalaryDto) {
    const { skip, take } = skipTake(query);

    const base = () =>
      this.applySalaryFilters(
        this.salaryRepo
          .createQueryBuilder('salary')
          .innerJoin('salary.agent', 'agent')
          .innerJoin('agent.user', 'agentUser'),
        query,
      );

    const [rows, total] = await Promise.all([
      base()
        .select('salary.id', 'id')
        .addSelect('salary.agentId', 'agentId')
        .addSelect('agent.firstName', 'firstName')
        .addSelect('agent.lastName', 'lastName')
        .addSelect('agentUser.mobile', 'mobile')
        .addSelect('salary.month', 'month')
        .addSelect('salary.year', 'year')
        .addSelect('salary.fixedSalary', 'fixedSalary')
        .addSelect('salary.incentive', 'incentive')
        .addSelect('salary.referralBonus', 'referralBonus')
        .addSelect('salary.deductions', 'deductions')
        .addSelect('salary.netSalary', 'netSalary')
        .addSelect('salary.status', 'status')
        .addSelect('salary.createdAt', 'createdAt')
        .orderBy('salary.year', 'DESC')
        .addOrderBy('salary.month', 'DESC')
        .addOrderBy('agent.firstName', 'ASC')
        .offset(skip)
        .limit(take)
        .getRawMany<{
          id: string;
          agentId: string;
          firstName: string;
          lastName: string | null;
          mobile: string;
          month: number;
          year: number;
          fixedSalary: string;
          incentive: string;
          referralBonus: string;
          deductions: string;
          netSalary: string;
          status: string;
          createdAt: Date;
        }>(),
      base().getCount(),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        agentId: row.agentId,
        agentName: this.fullName(row.firstName, row.lastName),
        agentMobile: row.mobile,
        month: Number(row.month),
        year: Number(row.year),
        fixedSalary: Number(row.fixedSalary),
        incentive: Number(row.incentive),
        referralBonus: Number(row.referralBonus),
        deductions: Number(row.deductions),
        netSalary: Number(row.netSalary),
        status: row.status,
        createdAt: row.createdAt,
      })),
      total,
      query,
    );
  }

  /**
   * netSalary = fixed salary + that month's incentive + referral bonus -
   * deductions, for every APPROVED agent. The referral bonus is the agent's
   * pending referral rewards up to the end of the month. Existing deductions
   * entered by an admin are preserved, and rows already APPROVED or PAID are
   * skipped.
   */
  async generateSalary(adminId: string, dto: GenerateAdminSalaryDto) {
    const fixedSalary = await this.settings.getNumber(
      SETTING_KEYS.AGENT_FIXED_SALARY,
      DEFAULT_FIXED_SALARY,
    );

    const agents = await this.agentRepo.find({
      where: { approvalStatus: 'APPROVED' },
      select: ['id'],
    });

    const incentives = await this.incentiveRepo.find({
      where: { month: dto.month, year: dto.year },
    });
    const incentiveByAgent = new Map(
      incentives.map((row) => [row.agentId, Number(row.incentiveAmount)]),
    );

    let generated = 0;
    let updated = 0;
    let skipped = 0;
    let totalNet = 0;

    for (const agent of agents) {
      const existing = await this.salaryRepo.findOne({
        where: { agentId: agent.id, month: dto.month, year: dto.year },
      });

      if (existing && SETTLED_STATUSES.includes(existing.status)) {
        skipped += 1;
        totalNet += Number(existing.netSalary);
        continue;
      }

      const incentive = incentiveByAgent.get(agent.id) ?? 0;
      const deductions = existing ? Number(existing.deductions) : 0;

      const record =
        existing ??
        this.salaryRepo.create({
          agentId: agent.id,
          month: dto.month,
          year: dto.year,
        });

      record.fixedSalary = fixedSalary.toFixed(2);
      record.incentive = incentive.toFixed(2);
      record.deductions = deductions.toFixed(2);
      record.status = 'PENDING';
      // Saved first so a new record has an id to attach rewards to.
      await this.salaryRepo.save(record);

      const referralBonus = await this.referralRewards.attachToSalary(
        this.salaryRepo.manager,
        record,
      );
      const netSalary = fixedSalary + incentive + referralBonus - deductions;
      record.referralBonus = referralBonus.toFixed(2);
      record.netSalary = netSalary.toFixed(2);
      await this.salaryRepo.save(record);

      if (existing) updated += 1;
      else generated += 1;
      totalNet += netSalary;
    }

    const summary = {
      month: dto.month,
      year: dto.year,
      fixedSalary,
      agents: agents.length,
      generated,
      updated,
      skipped,
      totalNetSalary: Number(totalNet.toFixed(2)),
    };

    await this.audit.record({
      userId: adminId,
      action: 'SALARY_GENERATED',
      entityType: 'salary_records',
      entityId: null,
      oldData: null,
      newData: summary,
    });

    return summary;
  }

  async updateSalary(adminId: string, id: string, dto: UpdateAdminSalaryDto) {
    const salary = await this.salaryRepo.findOne({ where: { id } });
    if (!salary) throw new NotFoundException('Salary record not found');

    const oldData = {
      status: salary.status,
      deductions: salary.deductions,
      referralBonus: salary.referralBonus,
      netSalary: salary.netSalary,
    };

    if (dto.deductions !== undefined) {
      salary.deductions = dto.deductions.toFixed(2);
    }
    if (dto.status !== undefined) salary.status = dto.status;

    // Paying the salary pays its referral rewards; rejecting it frees them
    // for the next salary.
    const referralBonus = await this.referralRewards.syncWithSalary(
      this.salaryRepo.manager,
      salary,
    );
    salary.referralBonus = referralBonus.toFixed(2);
    salary.netSalary = (
      Number(salary.fixedSalary) +
      Number(salary.incentive) +
      referralBonus -
      Number(salary.deductions)
    ).toFixed(2);
    await this.salaryRepo.save(salary);

    if (salary.status === 'APPROVED' || salary.status === 'PAID') {
      const agent = await this.agentRepo.findOne({
        where: { id: salary.agentId },
        select: ['id', 'userId'],
      });
      if (agent) {
        await this.notifications.toUser(agent.userId, {
          app: 'agent',
          title: salary.status === 'PAID' ? 'Salary paid' : 'Salary approved',
          message: `Your salary of ₹${Number(salary.netSalary).toFixed(2)} for ${salary.month}/${salary.year} has been ${salary.status.toLowerCase()}.${
            dto.remarks ? ` ${dto.remarks}` : ''
          }`,
          type: 'earnings',
        });
      }
    }

    await this.audit.record({
      userId: adminId,
      action: 'SALARY_UPDATED',
      entityType: 'salary_records',
      entityId: salary.id,
      oldData,
      newData: {
        status: salary.status,
        deductions: salary.deductions,
        referralBonus: salary.referralBonus,
        netSalary: salary.netSalary,
        remarks: dto.remarks ?? null,
      },
    });

    return {
      id: salary.id,
      agentId: salary.agentId,
      month: salary.month,
      year: salary.year,
      fixedSalary: Number(salary.fixedSalary),
      incentive: Number(salary.incentive),
      referralBonus: Number(salary.referralBonus),
      deductions: Number(salary.deductions),
      netSalary: Number(salary.netSalary),
      status: salary.status,
    };
  }

  private earningBaseQuery() {
    return this.earningRepo
      .createQueryBuilder('earning')
      .innerJoin('earning.agent', 'agent')
      .leftJoin('earning.booking', 'booking');
  }

  private applyEarningFilters(
    qb: SelectQueryBuilder<AgentEarning>,
    query: ListAdminEarningsDto,
  ) {
    if (query.search) {
      qb.andWhere(
        `(booking.bookingNumber ILIKE :search OR agent.firstName ILIKE :search
          OR agent.lastName ILIKE :search)`,
        { search: `%${query.search.trim()}%` },
      );
    }
    if (query.agentId) {
      qb.andWhere('earning.agentId = :agentId', { agentId: query.agentId });
    }
    if (query.from) {
      qb.andWhere('earning.earningDate >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('earning.earningDate <= :to', { to: query.to });
    }
    this.access.restrictAgent(qb, 'agent');
    return qb;
  }

  private applyIncentiveFilters(
    qb: SelectQueryBuilder<AgentIncentive>,
    query: ListAdminIncentivesDto,
  ) {
    if (query.search) {
      qb.andWhere(
        '(agent.firstName ILIKE :search OR agent.lastName ILIKE :search)',
        { search: `%${query.search.trim()}%` },
      );
    }
    if (query.agentId) {
      qb.andWhere('incentive.agentId = :agentId', { agentId: query.agentId });
    }
    if (query.month) {
      qb.andWhere('incentive.month = :month', { month: query.month });
    }
    if (query.year) {
      qb.andWhere('incentive.year = :year', { year: query.year });
    }
    if (query.status) {
      qb.andWhere('incentive.status = :status', { status: query.status });
    }
    this.access.restrictAgent(qb, 'agent');
    return qb;
  }

  private applySalaryFilters(
    qb: SelectQueryBuilder<SalaryRecord>,
    query: ListAdminSalaryDto,
  ) {
    if (query.search) {
      qb.andWhere(
        '(agent.firstName ILIKE :search OR agent.lastName ILIKE :search)',
        { search: `%${query.search.trim()}%` },
      );
    }
    if (query.agentId) {
      qb.andWhere('salary.agentId = :agentId', { agentId: query.agentId });
    }
    if (query.month) {
      qb.andWhere('salary.month = :month', { month: query.month });
    }
    if (query.year) {
      qb.andWhere('salary.year = :year', { year: query.year });
    }
    if (query.status) {
      qb.andWhere('salary.status = :status', { status: query.status });
    }
    this.access.restrictAgent(qb, 'agent');
    return qb;
  }

  private toIncentiveResponse(incentive: AgentIncentive) {
    return {
      id: incentive.id,
      agentId: incentive.agentId,
      month: incentive.month,
      year: incentive.year,
      revenueGenerated: Number(incentive.revenueGenerated),
      thresholdAmount: Number(incentive.thresholdAmount),
      incentiveAmount: Number(incentive.incentiveAmount),
      status: incentive.status,
    };
  }

  private fullName(firstName: string | null, lastName: string | null) {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  }
}
