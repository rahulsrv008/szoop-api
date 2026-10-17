import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { Agent, AgentMissedJob } from 'src/database/entities';
import type { MissedJobReason } from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { AuditService } from 'src/common/services/audit.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { AdminMissedJobAgentsDto, ListAdminMissedJobsDto, WarnAgentDto } from './dto/missed-jobs.dto';

/** How each reason reads in the admin panel. */
export const MISSED_JOB_LABELS: Record<MissedJobReason, string> = {
  NO_ON_THE_WAY: "Didn't set off",
  NOT_MOVING: 'Not moving',
  CUSTOMER_REPLACED: 'Customer asked for another',
  NOT_STARTED: 'Never started',
  PLAN_VISIT_MISSED: 'Plan visit missed',
};

type AgentRow = {
  agentId: string;
  firstName: string | null;
  lastName: string | null;
  mobile: string | null;
  agentStatus: string | null;
  missed: number;
  noOnTheWay: number;
  notMoving: number;
  customerReplaced: number;
  notStarted: number;
  planVisitMissed: number;
  notWarned: number;
  lastMissedAt: Date | null;
  lastWarnedAt: Date | null;
};

/**
 * The admin panel's Missed jobs page: agents who held a job and didn't do it
 * (recorded by HeldJobsService), and warnings sent to them. Zone-restricted
 * admins only see agents in their zones.
 */
@Injectable()
export class AdminMissedJobsService {
  constructor(
    @InjectRepository(AgentMissedJob) private readonly missedRepo: Repository<AgentMissedJob>,
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    private readonly access: AdminAccessService,
    private readonly notifications: NotificationDispatchService,
    private readonly audit: AuditService,
  ) {}

  /** One row per agent with misses in the period, worst first. */
  async agents(query: AdminMissedJobAgentsDto) {
    const { from, to } = range(query);
    const qb = this.base(from, to)
      .select('missed.agentId', 'agentId')
      .addSelect('agent.firstName', 'firstName')
      .addSelect('agent.lastName', 'lastName')
      .addSelect('user.mobile', 'mobile')
      .addSelect('agent.status', 'agentStatus')
      .addSelect('COUNT(*)::int', 'missed')
      .addSelect(countOf('NO_ON_THE_WAY'), 'noOnTheWay')
      .addSelect(countOf('NOT_MOVING'), 'notMoving')
      .addSelect(countOf('CUSTOMER_REPLACED'), 'customerReplaced')
      .addSelect(countOf('NOT_STARTED'), 'notStarted')
      .addSelect(countOf('PLAN_VISIT_MISSED'), 'planVisitMissed')
      .addSelect('COUNT(*) FILTER (WHERE missed.warned_at IS NULL)::int', 'notWarned')
      .addSelect('MAX(missed.slot)', 'lastMissedAt')
      // Their last warning ever, not only within the period.
      .addSelect(
        '(SELECT MAX(w.warned_at) FROM agent_missed_jobs w WHERE w.agent_id = missed.agent_id)',
        'lastWarnedAt',
      )
      .groupBy('missed.agentId')
      .addGroupBy('agent.firstName')
      .addGroupBy('agent.lastName')
      .addGroupBy('user.mobile')
      .addGroupBy('agent.status')
      .orderBy('"missed"', 'DESC')
      .addOrderBy('"lastMissedAt"', 'DESC');

    if (query.search?.trim()) {
      qb.andWhere(
        "((agent.firstName || ' ' || COALESCE(agent.lastName, '')) ILIKE :search OR user.mobile ILIKE :search)",
        { search: `%${query.search.trim()}%` },
      );
    }

    const rows = await qb.getRawMany<AgentRow>();
    const items = rows.map((row) => ({
      agentId: row.agentId,
      agentName: [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || 'Agent',
      agentMobile: row.mobile,
      agentStatus: row.agentStatus,
      missed: Number(row.missed),
      byReason: {
        NO_ON_THE_WAY: Number(row.noOnTheWay),
        NOT_MOVING: Number(row.notMoving),
        CUSTOMER_REPLACED: Number(row.customerReplaced),
        NOT_STARTED: Number(row.notStarted),
        PLAN_VISIT_MISSED: Number(row.planVisitMissed),
      },
      notWarned: Number(row.notWarned),
      lastMissedAt: row.lastMissedAt,
      lastWarnedAt: row.lastWarnedAt,
    }));

    return {
      range: { from, to },
      items,
      totals: {
        agents: items.length,
        missed: items.reduce((sum, row) => sum + row.missed, 0),
        notWarned: items.reduce((sum, row) => sum + row.notWarned, 0),
      },
      labels: MISSED_JOB_LABELS,
    };
  }

  /** The missed bookings themselves, newest first. */
  async list(query: ListAdminMissedJobsDto) {
    const { from, to } = range(query);
    const qb = this.base(from, to)
      .innerJoinAndSelect('missed.booking', 'booking')
      .leftJoinAndSelect('booking.customer', 'customer')
      .addSelect(['agent.id', 'agent.firstName', 'agent.lastName', 'user.mobile'])
      .orderBy('missed.slot', 'DESC');
    if (query.agentId) qb.andWhere('missed.agentId = :agentId', { agentId: query.agentId });
    if (query.reason) qb.andWhere('missed.reason = :reason', { reason: query.reason });

    const { skip, take } = skipTake(query);
    const [rows, total] = await qb.skip(skip).take(take).getManyAndCount();
    return paginated(
      rows.map((row) => ({
        id: row.id,
        agentId: row.agentId,
        agentName: [row.agent?.firstName, row.agent?.lastName].filter(Boolean).join(' ').trim() || 'Agent',
        agentMobile: row.agent?.user?.mobile ?? null,
        bookingId: row.bookingId,
        bookingNumber: row.booking?.bookingNumber ?? null,
        service: row.booking?.planTitle ?? null,
        bookingMode: row.booking?.bookingMode ?? null,
        bookingStatus: row.booking?.status ?? null,
        customerName: row.booking?.customer?.firstName ?? null,
        slot: row.slot,
        reason: row.reason,
        reasonLabel: MISSED_JOB_LABELS[row.reason] ?? row.reason,
        details: row.details,
        warnedAt: row.warnedAt,
        createdAt: row.createdAt,
      })),
      total,
      query,
    );
  }

  /** The standard warning for this agent, for the admin to read (and edit) before sending. */
  async warningPreview(agentId: string) {
    const agent = await this.agentRepo.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');
    this.access.assertAgent(agent);
    const unwarned = await this.unwarned(agentId);
    return { agentId, notWarned: unwarned.length, message: defaultWarning(unwarned) };
  }

  /**
   * Sends the agent a warning (push + in-app) and marks the misses it covers.
   * The default message lists the bookings they haven't been warned about yet.
   */
  async warn(adminId: string, agentId: string, dto: WarnAgentDto) {
    const agent = await this.agentRepo.findOne({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');
    this.access.assertAgent(agent);

    const unwarned = await this.unwarned(agentId);
    const message = dto.message?.trim() || defaultWarning(unwarned);

    await this.notifications.toUser(agent.userId, {
      app: 'agent',
      title: 'Warning about missed jobs',
      message,
      type: 'agent_warning',
    });

    const warnedAt = new Date();
    if (unwarned.length) {
      await this.missedRepo.update(
        { id: In(unwarned.map((row) => row.id)) },
        { warnedAt, warnedBy: adminId },
      );
    }
    await this.audit.record({
      userId: adminId,
      action: 'AGENT_WARNED',
      entityType: 'agents',
      entityId: agent.id,
      newData: { message, missedJobIds: unwarned.map((row) => row.id) },
    });

    return { agentId, warnedJobs: unwarned.length, message, warnedAt };
  }

  private unwarned(agentId: string) {
    return this.missedRepo.find({
      where: { agentId, warnedAt: IsNull() },
      relations: ['booking'],
      order: { slot: 'DESC' },
    });
  }

  /** Misses in the period, joined to the agent and limited to the admin's zones. */
  private base(from: string, to: string): SelectQueryBuilder<AgentMissedJob> {
    const qb = this.missedRepo
      .createQueryBuilder('missed')
      .innerJoin('missed.agent', 'agent')
      .innerJoin('agent.user', 'user')
      .where('missed.slot >= :start AND missed.slot < :end', {
        start: new Date(`${from}T00:00:00`),
        end: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000),
      });
    this.access.restrictAgent(qb, 'agent');
    return qb;
  }
}

function countOf(reason: MissedJobReason) {
  return `COUNT(*) FILTER (WHERE missed.reason = '${reason}')::int`;
}

/** Inclusive local dates, the last 30 days by default (like the other admin reports). */
function range(query: { from?: string; to?: string }) {
  const to = query.to?.slice(0, 10) ?? localDate(new Date());
  const from =
    query.from?.slice(0, 10) ??
    localDate(new Date(new Date(`${to}T00:00:00`).getTime() - 29 * 86_400_000));
  return { from, to };
}

function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function defaultWarning(unwarned: AgentMissedJob[]) {
  const numbers = unwarned
    .map((row) => row.booking?.bookingNumber)
    .filter(Boolean)
    .slice(0, 5);
  const which = numbers.length
    ? `You missed ${unwarned.length} job${unwarned.length === 1 ? '' : 's'} (${numbers.join(', ')}${unwarned.length > numbers.length ? ', …' : ''}). `
    : 'You have missed jobs recently. ';
  return (
    `${which}Missed jobs leave customers waiting. Only accept jobs you can do, and tap "I'm on my way" when you leave. ` +
    'More missed jobs may lead to your account being reviewed.'
  );
}
