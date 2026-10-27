import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Agent, AgentAvailability, Booking, BookingDispatch } from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { AuditService } from 'src/common/services/audit.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import { SettingsService } from 'src/common/services/settings.service';
import { haversineKm } from 'src/common/geo/geo.util';
import { toDateString, todayString } from 'src/agent/shared/date.util';
import { DispatchService } from 'src/dispatch/dispatch.service';
import {
  instantSearchEndsAt,
  scheduledDispatchLeadMinutes,
  serviceNames,
  slotMinutes,
  toMinutes,
} from 'src/dispatch/dispatch.rules';
import {
  FRESH_LOCATION_MINUTES,
  MIN_MINUTES_AFTER_ACCEPT,
  MOVING_CHECK_MINUTES,
  ON_THE_WAY_CUTOFF_MINUTES,
  START_GRACE_MINUTES,
} from 'src/dispatch/held-jobs.service';
import {
  DEFAULT_MONITOR_RULES,
  MONITOR_RULES_SETTING,
  MonitorRules,
  MonitorSeverity,
  MonitorStep,
  RULE_PAIRS,
  addMinutes,
  latest,
  limitsFor,
  localMoment,
  resolveRules,
  severityAt,
  severityRank,
  worse,
} from './booking-monitor.rules';
import { UpdateMonitorRulesDto } from './dto/update-monitor-rules.dto';
import { MonitorNudgeDto } from './dto/monitor-nudge.dto';

/** A job whose slot is older than this is history, not live (the Missed jobs page has it). */
const LOOKBACK_HOURS = 12;
/** A broadcast sent straight from payment or a release should be out within this long. */
const KICK_GRACE_MINUTES = 1;
/** How often the admin panel polls; the panel recolours every second in between. */
const REFRESH_SECONDS = 60;

const LIVE_STATUSES: Booking['status'][] = ['paid', 'accepted', 'arriving', 'ongoing'];

export type Presence = 'online' | 'off_hours' | 'offline';
export type FlagTone = 'info' | 'warn' | 'danger';

export interface MonitorFlag {
  code: string;
  label: string;
  tone: FlagTone;
}

interface Classified {
  booking: Booking;
  step: MonitorStep;
  /** The single job's start, or a plan's current/next visit. */
  slot: Date;
  plan: boolean;
  clockStartsAt: Date;
  /** What the timer is measured from, e.g. "broadcast 1:15 PM". */
  note: string | null;
  floor: MonitorSeverity | null;
  flags: MonitorFlag[];
  nextAction: { label: string; at: Date } | null;
  onBoard: boolean;
}

interface OfferStats {
  offered: number;
  pending: number;
  declined: number;
  /** First offer since dispatch last (re)started: when the job actually went out to agents. */
  firstOfferAt: Date | null;
}

interface Eta {
  etaMinutes: number;
  computedAt: Date;
}

interface Nudge {
  agentId: string;
  kind: string;
  at: Date;
}

/** Everything one board needs besides the bookings themselves. */
interface Context {
  now: Date;
  rules: MonitorRules;
  history: Map<string, Date>;
  visits: Map<string, { date: string; time: string }>;
  dispatches: Map<string, BookingDispatch>;
  offers: Map<string, OfferStats>;
  etas: Map<string, Eta>;
  nudges: Map<string, Nudge[]>;
  presence: Map<string, AgentPresence>;
  onlineInZone: Map<string, number>;
}

interface AgentPresence {
  state: Presence;
  /** For the agent's own row, e.g. "Hasn't come online today". */
  label: string;
  /** For a job they hold, e.g. "Agent hasn't come online today". */
  jobLabel: string;
}

const STEP_OF: Record<string, MonitorStep> = {
  accepted: 'NOT_SET_OFF',
  arriving: 'ON_THE_WAY',
  ongoing: 'IN_PROGRESS',
};

const NOT_ONLINE_TODAY: AgentPresence = {
  state: 'offline',
  label: "Hasn't come online today",
  jobLabel: "Agent hasn't come online today",
};

const RULE_NAMES: Record<string, string> = {
  waitingRedMinutes: 'waiting for an agent',
  setOffRedMinutes: 'not on the way',
  arrivalRedMinutes: 'on the way, not started',
  overrunRedMinutes: 'in progress',
};

/**
 * The admin panel's booking monitor: every live job, the step it's in, and
 * when that step's clock started. A paid job with no agent is listed at once
 * (the 3/5 min clock still starts at the broadcast). Assigned jobs wait until
 * that step is live. A step turns orange, then red,
 * the given number of minutes after its clock starts (MonitorRules), or
 * straight away when something blocks it — no agent online to take it, or
 * the assigned agent hasn't come online today. Times are absolute so the
 * panel can recolour every second between polls. Zone admins only see jobs
 * and agents in their zones.
 */
@Injectable()
export class AdminBookingMonitorService {
  private readonly logger = new Logger(AdminBookingMonitorService.name);

  constructor(
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(AgentAvailability)
    private readonly availabilityRepo: Repository<AgentAvailability>,
    @InjectRepository(BookingDispatch)
    private readonly dispatchRepo: Repository<BookingDispatch>,
    private readonly dispatch: DispatchService,
    private readonly access: AdminAccessService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationDispatchService,
  ) {}

  async board() {
    // The same request-driven tick the apps' polls run, so on a host without a
    // timer the jobs on screen still expire, get released and move on.
    await this.dispatch.tickFromRequest();

    const now = new Date();
    const rules = await this.rules();
    const bookings = await this.liveBookings(now, rules);
    const ids = bookings.map((booking) => booking.id);
    const waitingIds = bookings
      .filter((booking) => booking.status === 'paid' && !booking.agentId)
      .map((booking) => booking.id);
    const arrivingIds = bookings
      .filter((booking) => booking.status === 'arriving')
      .map((booking) => booking.id);

    const history = await this.latestHistory(ids);
    const visits = await this.nextVisits(ids);
    const dispatches = await this.dispatchesOf(waitingIds);
    const offers = await this.offerStats(waitingIds);
    const etas = await this.etasOf(arrivingIds);
    const nudges = await this.nudgesOf(ids);

    const agents = await this.agentsInScope(
      bookings.map((booking) => booking.agent).filter((agent): agent is Agent => !!agent),
    );
    const presence = await this.presenceOf(agents, now);
    const onlineInZone = new Map<string, number>();
    for (const agent of agents) {
      if (presence.get(agent.id)?.state !== 'online') continue;
      for (const zoneId of new Set([agent.homeZoneId, ...(agent.serviceAreas ?? [])].filter(Boolean))) {
        onlineInZone.set(zoneId, (onlineInZone.get(zoneId) ?? 0) + 1);
      }
    }

    const context: Context = {
      now,
      rules,
      history,
      visits,
      dispatches,
      offers,
      etas,
      nudges,
      presence,
      onlineInZone,
    };
    const classified = bookings.map((booking) => this.classify(booking, context));

    const jobs = classified
      .filter((job) => job.onBoard)
      .map((job) => this.toJob(job, context))
      .sort(
        (a, b) =>
          severityRank(b.severity) - severityRank(a.severity) ||
          Number(b.running) - Number(a.running) ||
          new Date(a.clockStartsAt).getTime() - new Date(b.clockStartsAt).getTime(),
      );
    const agentRows = this.toAgents(agents, classified, context);

    return {
      serverTime: now.toISOString(),
      refreshSeconds: REFRESH_SECONDS,
      rules,
      /** How long before its start a scheduled job opens to agents (for the panel's legend). */
      dispatchLeadMinutes: scheduledDispatchLeadMinutes(),
      jobs,
      agents: agentRows,
      counts: {
        jobs: {
          total: jobs.length,
          red: jobs.filter((job) => job.severity === 'red').length,
          orange: jobs.filter((job) => job.severity === 'orange').length,
          ok: jobs.filter((job) => job.severity === 'ok').length,
        },
        agents: {
          total: agentRows.length,
          online: agentRows.filter((agent) => agent.presence === 'online').length,
          busy: agentRows.filter((agent) => !!agent.currentJob).length,
          alerts: agentRows.filter((agent) => agent.severity === 'orange' || agent.severity === 'red').length,
        },
      },
    };
  }

  async updateRules(adminId: string, dto: UpdateMonitorRulesDto) {
    this.access.assertSuperAdmin();
    const current = await this.rules();
    const next: MonitorRules = { ...current };
    for (const key of Object.keys(DEFAULT_MONITOR_RULES) as (keyof MonitorRules)[]) {
      const value = dto[key];
      if (value !== undefined && value !== null) next[key] = value;
    }
    for (const [orange, red] of RULE_PAIRS) {
      if (next[red] < next[orange]) {
        throw new BadRequestException(
          `Red must not come before orange (${RULE_NAMES[red]}: orange ${next[orange]} min, red ${next[red]} min)`,
        );
      }
    }

    const saved = await this.settings.set(MONITOR_RULES_SETTING, next, {
      description: 'Booking monitor: minutes before a live job turns orange and red',
      updatedBy: adminId,
    });
    await this.audit.record({
      userId: adminId,
      action: 'SETTING_UPDATED',
      entityType: 'system_settings',
      entityId: saved.id,
      oldData: { settingKey: MONITOR_RULES_SETTING, settingValue: current },
      newData: { settingKey: MONITOR_RULES_SETTING, settingValue: next },
    });
    return resolveRules(next);
  }

  /**
   * A push + in-app notice to one agent. Zone admins can only nudge agents in
   * their zones, or whoever holds a job in their zones (with that booking).
   */
  async nudge(adminId: string, dto: MonitorNudgeDto) {
    const agent = await this.agentRepo.findOne({ where: { id: dto.agentId } });
    if (!agent) throw new NotFoundException('Agent not found');
    let booking: Booking | null = null;
    if (dto.bookingId) {
      booking = await this.bookingRepo.findOne({ where: { id: dto.bookingId } });
      if (!booking || booking.agentId !== agent.id) throw new NotFoundException('Booking not found');
      this.access.assertZone(booking.serviceAreaId, 'Booking');
    } else {
      this.access.assertAgent(agent);
    }

    await this.notifications.toUser(agent.userId, {
      app: 'agent',
      title: dto.title,
      message: dto.message,
      type: 'job_reminder',
      ...(booking ? { data: { bookingId: booking.id, bookingNumber: booking.bookingNumber } } : {}),
    });
    await this.audit.record({
      userId: adminId,
      action: 'MONITOR_NUDGE_SENT',
      entityType: booking ? 'bookings' : 'agents',
      entityId: booking?.id ?? agent.id,
      newData: { agentId: agent.id, title: dto.title, message: dto.message },
    });
    return { sent: true };
  }

  private async rules() {
    return resolveRules(await this.settings.get<unknown>(MONITOR_RULES_SETTING, null));
  }

  // ------------------------------------------------------------ the steps

  private classify(booking: Booking, ctx: Context): Classified {
    const visit = ctx.visits.get(booking.id);
    const plan = !!visit;
    const slot = visit ? localMoment(visit.date, visit.time) : localMoment(booking.bookingDate, booking.startTime);
    const base = { booking, slot, plan };
    const job =
      booking.status === 'paid' && !booking.agentId
        ? this.waitingForAgent(base, ctx)
        : STEP_OF[booking.status] === 'ON_THE_WAY'
          ? this.onTheWay(base, ctx)
          : STEP_OF[booking.status] === 'IN_PROGRESS'
            ? this.inProgress(base, ctx)
            : this.notSetOff(base, ctx); // accepted, or 'paid' in the moment an agent claims it

    const running = job.clockStartsAt.getTime() <= ctx.now.getTime();
    const live = job.step === 'ON_THE_WAY' || job.step === 'IN_PROGRESS';
    const recent = slot.getTime() >= addMinutes(ctx.now, -LOOKBACK_HOURS * 60).getTime();
    // Paid and still unassigned: on the board at once (the 3/5 min clock still
    // starts at the broadcast). Assigned jobs wait until their step is live.
    const onBoard =
      live ||
      job.step === 'WAITING_FOR_AGENT' ||
      (running && recent);
    return { ...job, onBoard };
  }

  /**
   * Paid, nobody holds it. Timed from the broadcast: the first offer since
   * dispatch last (re)started. Payment and releases broadcast at once;
   * scheduled one-offs go out on the first dispatch tick after their lead
   * time. If it should have gone out and still hasn't, it's timed from then.
   */
  private waitingForAgent(base: Pick<Classified, 'booking' | 'slot' | 'plan'>, ctx: Context) {
    const { booking, slot } = base;
    const flags: MonitorFlag[] = [];
    let floor: MonitorSeverity | null = null;
    const dispatch = ctx.dispatches.get(booking.id);
    const offers = ctx.offers.get(booking.id);
    const leadOpensAt =
      booking.bookingMode === 'SCHEDULED' && booking.planType !== 'MONTHLY'
        ? addMinutes(localMoment(booking.bookingDate, booking.startTime), -scheduledDispatchLeadMinutes())
        : null;
    const paidAt = ctx.history.get(key(booking.id, 'paid')) ?? booking.createdAt;
    const dueAt = latest(paidAt, dispatch?.createdAt, leadOpensAt) ?? booking.createdAt;
    // A broadcast that found nobody leaves no offer, only an advanced or exhausted dispatch.
    const broadcastAt =
      offers?.firstOfferAt ??
      (dispatch && (dispatch.wave > 0 || dispatch.status === 'exhausted') ? dueAt : null);
    const waitsForTick = !!leadOpensAt && dueAt.getTime() === leadOpensAt.getTime();
    const overdueAt = addMinutes(dueAt, waitsForTick ? broadcastGraceMinutes() : KICK_GRACE_MINUTES);
    const clockStartsAt = broadcastAt ?? overdueAt;
    const running = clockStartsAt.getTime() <= ctx.now.getTime();

    if (!broadcastAt && running) {
      flags.push({
        code: 'NOT_BROADCAST',
        tone: 'danger',
        label: `Not broadcast to agents yet (due ${clock(dueAt)})`,
      });
      floor = worse('red', floor);
    }
    const zoneOnline = booking.serviceAreaId ? (ctx.onlineInZone.get(booking.serviceAreaId) ?? 0) : null;
    if (zoneOnline === 0) {
      flags.push({
        code: 'NO_AGENTS_ONLINE',
        tone: 'warn',
        label: `No agents online in ${booking.serviceArea?.name ?? 'this zone'}`,
      });
      floor = worse('orange', floor);
    }
    if (dispatch?.status === 'exhausted') {
      flags.push({ code: 'NOBODY_AVAILABLE', tone: 'warn', label: 'Dispatch found no free agent nearby' });
      floor = worse('orange', floor);
    }
    if (offers?.offered) {
      const parts = [`Offered to ${offers.offered} ${offers.offered === 1 ? 'agent' : 'agents'}`];
      if (offers.pending) parts.push(`${offers.pending} deciding`);
      if (offers.declined) parts.push(`${offers.declined} declined`);
      flags.push({ code: 'OFFERS', tone: 'info', label: parts.join(' · ') });
    }
    if (slot.getTime() < ctx.now.getTime()) {
      flags.push({ code: 'START_PASSED', tone: 'danger', label: `Start time ${clock(slot)} has passed` });
      floor = worse('red', floor);
    }

    let nextAction: Classified['nextAction'] = null;
    if (booking.bookingMode === 'INSTANT') {
      nextAction = { label: 'Expires and the customer is refunded', at: instantSearchEndsAt(booking) };
    } else if (!base.plan && slot.getTime() > ctx.now.getTime()) {
      nextAction = { label: 'Stops being offered at its start', at: slot };
    }
    return {
      ...base,
      step: 'WAITING_FOR_AGENT' as const,
      clockStartsAt,
      note: broadcastAt ? `broadcast ${clock(broadcastAt)}` : null,
      floor,
      flags,
      nextAction,
    };
  }

  /**
   * An agent holds it but hasn't tapped "I'm on my way": timed from when they
   * picked it, but never from before its broadcast (a job an admin assigned
   * early starts when it would have gone out). Plans aren't broadcast per
   * visit, so a visit is timed from setOffLeadMinutes before it.
   */
  private notSetOff(base: Pick<Classified, 'booking' | 'slot' | 'plan'>, ctx: Context) {
    const { booking, slot, plan } = base;
    const flags: MonitorFlag[] = [];
    let floor: MonitorSeverity | null = null;
    const acceptedAt = ctx.history.get(key(booking.id, 'accepted')) ?? booking.updatedAt;
    const trackedFrom = plan
      ? addMinutes(slot, -ctx.rules.setOffLeadMinutes)
      : booking.bookingMode === 'SCHEDULED'
        ? addMinutes(slot, -scheduledDispatchLeadMinutes())
        : null;
    const clockStartsAt = latest(acceptedAt, trackedFrom) ?? acceptedAt;

    const presence = booking.agentId ? ctx.presence.get(booking.agentId) : undefined;
    if (presence && presence.state !== 'online') {
      flags.push({ code: 'AGENT_OFFLINE', tone: 'warn', label: presence.jobLabel });
      floor = worse('orange', floor);
    }
    for (const nudge of this.nudgesFor(booking, ctx)) {
      if (nudge.kind === 'warning') {
        flags.push({ code: 'WARNED', tone: 'info', label: `Last warning sent ${clock(nudge.at)}` });
      } else if (nudge.kind === 'reminder') {
        flags.push({ code: 'REMINDED', tone: 'info', label: `Reminder sent ${clock(nudge.at)}` });
      }
    }

    const nextAction = plan
      ? { label: 'Flagged as a missed visit', at: addMinutes(slot, START_GRACE_MINUTES) }
      : {
          label: 'Goes to another agent',
          at:
            latest(
              addMinutes(slot, -ON_THE_WAY_CUTOFF_MINUTES),
              addMinutes(acceptedAt, MIN_MINUTES_AFTER_ACCEPT),
            ) ?? slot,
        };
    return {
      ...base,
      step: 'NOT_SET_OFF' as const,
      clockStartsAt,
      note: plan ? `visit ${clock(slot)}` : `picked ${clock(acceptedAt)}`,
      floor,
      flags,
      nextAction,
    };
  }

  /** On the way, not started. Due at the slot; "Right now" also gets instantArrivalMinutes to get there. */
  private onTheWay(base: Pick<Classified, 'booking' | 'slot' | 'plan'>, ctx: Context) {
    const { booking, slot, plan } = base;
    const flags: MonitorFlag[] = [];
    const arrivingAt = ctx.history.get(key(booking.id, 'arriving')) ?? booking.updatedAt;
    const instant = booking.bookingMode === 'INSTANT' && !plan;
    const clockStartsAt = instant
      ? (latest(slot, addMinutes(arrivingAt, ctx.rules.instantArrivalMinutes)) ?? slot)
      : slot;

    const fix = booking.agent?.currentLocation;
    if (fix) {
      const ageMinutes = Math.floor((ctx.now.getTime() - new Date(fix.recordedAt).getTime()) / 60_000);
      if (ageMinutes > FRESH_LOCATION_MINUTES) {
        flags.push({ code: 'NO_LOCATION', tone: 'warn', label: `No location from the agent for ${minutesText(ageMinutes)}` });
      }
    } else {
      flags.push({ code: 'NO_LOCATION', tone: 'warn', label: 'Agent has never shared a location' });
    }
    const km = this.distanceKm(booking);
    if (km !== null) flags.push({ code: 'DISTANCE', tone: 'info', label: `${km.toFixed(1)} km from the customer` });
    const eta = ctx.etas.get(booking.id);
    if (eta) {
      flags.push({
        code: 'ETA',
        tone: 'info',
        label: `Route ETA: arrives ~${clock(addMinutes(eta.computedAt, eta.etaMinutes))}`,
      });
    }
    if (this.nudgesFor(booking, ctx).some((nudge) => nudge.kind === 'no_location')) {
      flags.push({ code: 'ASKED_FOR_LOCATION', tone: 'info', label: 'Agent was asked to open the app' });
    }

    const movingCheck = addMinutes(arrivingAt, MOVING_CHECK_MINUTES);
    const nextAction = plan
      ? { label: 'Flagged as a missed visit', at: addMinutes(slot, START_GRACE_MINUTES) }
      : instant && movingCheck.getTime() > ctx.now.getTime()
        ? { label: 'Checks the agent is moving', at: movingCheck }
        : { label: 'Cancels and refunds the customer', at: addMinutes(slot, START_GRACE_MINUTES) };
    return {
      ...base,
      step: 'ON_THE_WAY' as const,
      clockStartsAt,
      note: `set off ${clock(arrivingAt)}`,
      floor: null,
      flags,
      nextAction,
    };
  }

  /** Started; due to be marked complete at the end of the booked time. */
  private inProgress(base: Pick<Classified, 'booking' | 'slot' | 'plan'>, ctx: Context) {
    const { booking } = base;
    const flags: MonitorFlag[] = [];
    const startedAt = ctx.history.get(key(booking.id, 'ongoing')) ?? booking.updatedAt;
    const clockStartsAt = addMinutes(startedAt, slotMinutes(booking));
    if (booking.paymentMode === 'AFTER_SERVICE' && booking.paymentStatus !== 'PAID') {
      flags.push({ code: 'PAY_AFTER_SERVICE', tone: 'info', label: 'Customer pays after service' });
    }
    return {
      ...base,
      step: 'IN_PROGRESS' as const,
      clockStartsAt,
      note: `started ${clock(startedAt)}`,
      floor: null,
      flags,
      nextAction: null,
    };
  }

  // --------------------------------------------------------- the response

  private toJob(job: Classified, ctx: Context) {
    const { booking } = job;
    const { orange, red } = limitsFor(job.step, ctx.rules);
    const orangeAt = addMinutes(job.clockStartsAt, orange);
    const redAt = addMinutes(job.clockStartsAt, red);
    const agent = booking.agent;
    const presence = agent ? ctx.presence.get(agent.id) : undefined;
    const address = booking.address;
    return {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      step: job.step,
      mode: booking.bookingMode,
      plan: job.plan,
      service: serviceNames(booking)[0] ?? booking.planTitle ?? 'Booking',
      slot: job.slot.toISOString(),
      running: job.clockStartsAt.getTime() <= ctx.now.getTime(),
      clockStartsAt: job.clockStartsAt.toISOString(),
      note: job.note,
      orangeAt: orangeAt.toISOString(),
      redAt: redAt.toISOString(),
      floor: job.floor,
      severity: severityAt(ctx.now, orangeAt, redAt, job.floor),
      flags: job.flags,
      nextAction: job.nextAction
        ? { label: job.nextAction.label, at: job.nextAction.at.toISOString() }
        : null,
      customer: {
        name: fullName(booking.customer?.firstName, booking.customer?.lastName) ?? 'Customer',
        mobile: booking.customer?.user?.mobile ?? null,
      },
      area: booking.serviceArea ? { id: booking.serviceArea.id, name: booking.serviceArea.name } : null,
      address: address
        ? [address.addressLine1, address.city].filter(Boolean).join(', ') || null
        : null,
      agent: agent
        ? {
            id: agent.id,
            userId: agent.userId,
            name: fullName(agent.firstName, agent.lastName) ?? 'Agent',
            mobile: agent.user?.mobile ?? null,
            presence: presence?.state ?? 'offline',
            lastSeenAt: agent.currentLocation?.recordedAt ?? null,
            distanceKm: this.distanceKm(booking),
          }
        : null,
    };
  }

  /**
   * One row per agent. An agent with a job today who isn't online is orange,
   * and red once they should be heading to it. Someone already on the way or
   * working is never flagged for being "offline": the job is what matters then.
   */
  private toAgents(agents: Agent[], jobs: Classified[], ctx: Context) {
    const today = todayString();
    const held = new Map<string, Classified[]>();
    for (const job of jobs) {
      const agentId = job.booking.agentId;
      if (!agentId || job.step === 'WAITING_FOR_AGENT') continue;
      held.set(agentId, [...(held.get(agentId) ?? []), job]);
    }

    const rows = agents.map((agent) => {
      const presence = ctx.presence.get(agent.id) ?? NOT_ONLINE_TODAY;
      const mine = held.get(agent.id) ?? [];
      const current =
        mine.find((job) => job.step === 'IN_PROGRESS') ?? mine.find((job) => job.step === 'ON_THE_WAY');
      const todays = mine.filter((job) => toDateString(job.slot) === today);
      const next = todays
        .filter((job) => job.step === 'NOT_SET_OFF')
        .sort((a, b) => a.slot.getTime() - b.slot.getTime())[0];

      let alert: { orangeAt: string; redAt: string; reason: string } | null = null;
      let severity: MonitorSeverity | 'idle' = presence.state === 'online' ? 'ok' : 'idle';
      if (presence.state !== 'online' && next && !current) {
        alert = {
          orangeAt: ctx.now.toISOString(),
          redAt: next.clockStartsAt.toISOString(),
          reason: `${presence.label} · should set off by ${clock(next.clockStartsAt)}`,
        };
        severity = next.clockStartsAt.getTime() <= ctx.now.getTime() ? 'red' : 'orange';
      } else if (current) {
        severity = 'ok';
      }

      return {
        id: agent.id,
        userId: agent.userId,
        name: fullName(agent.firstName, agent.lastName) ?? 'Agent',
        mobile: agent.user?.mobile ?? null,
        zone: agent.homeZone?.name ?? null,
        presence: presence.state,
        presenceLabel: presence.label,
        lastSeenAt: agent.currentLocation?.recordedAt ?? null,
        currentJob: current
          ? { bookingId: current.booking.id, bookingNumber: current.booking.bookingNumber, step: current.step }
          : null,
        nextJob: next
          ? {
              bookingId: next.booking.id,
              bookingNumber: next.booking.bookingNumber,
              slot: next.slot.toISOString(),
              setOffBy: next.clockStartsAt.toISOString(),
            }
          : null,
        jobsToday: todays.length,
        alert,
        severity,
      };
    });

    const order = { red: 0, orange: 1, ok: 2, idle: 3 };
    const presenceOrder: Record<Presence, number> = { online: 0, off_hours: 1, offline: 2 };
    return rows.sort(
      (a, b) =>
        order[a.severity] - order[b.severity] ||
        Number(!!b.currentJob) - Number(!!a.currentJob) ||
        presenceOrder[a.presence] - presenceOrder[b.presence] ||
        a.name.localeCompare(b.name),
    );
  }

  // ------------------------------------------------------------ the data

  /**
   * paid / accepted / arriving / ongoing jobs that can matter now: everything
   * on the way or in progress; single jobs dated around today (all of today,
   * so the agents panel knows who has work later); plans with a visit around
   * today; and any paid job still waiting for an agent, however far off.
   */
  private liveBookings(now: Date, rules: MonitorRules) {
    const from = toDateString(addMinutes(now, -LOOKBACK_HOURS * 60));
    const ahead = Math.max(scheduledDispatchLeadMinutes(), rules.setOffLeadMinutes) + 5;
    const to = toDateString(addMinutes(now, ahead));
    const qb = this.bookingRepo
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.customer', 'customer')
      .leftJoinAndSelect('customer.user', 'customerUser')
      .leftJoinAndSelect('booking.agent', 'agent')
      .leftJoinAndSelect('agent.user', 'agentUser')
      .leftJoinAndSelect('booking.address', 'address')
      .leftJoinAndSelect('booking.serviceArea', 'serviceArea')
      .leftJoinAndSelect('booking.items', 'item')
      .leftJoinAndSelect('item.service', 'service')
      .where('booking.status IN (:...statuses)', { statuses: LIVE_STATUSES })
      .andWhere(
        new Brackets((live) =>
          live
            .where("booking.status IN ('arriving', 'ongoing')")
            .orWhere('booking.bookingDate BETWEEN :from AND :to', { from, to })
            .orWhere('booking.status = \'paid\' AND booking.agentId IS NULL')
            .orWhere(
              `EXISTS (
                 SELECT 1 FROM booking_visits visit
                 WHERE visit.booking_id = booking.id
                   AND visit.status IN ('pending', 'active')
                   AND visit.visit_date BETWEEN :from AND :to
               )`,
              { from, to },
            ),
        ),
      );
    this.access.restrictZoneColumn(qb, 'booking.service_area_id');
    return qb.getMany();
  }

  /** When each booking last entered each live status, keyed `bookingId:status`. */
  private async latestHistory(ids: string[]) {
    const map = new Map<string, Date>();
    if (!ids.length) return map;
    const rows: { booking_id: string; status: string; created_at: Date }[] = await this.bookingRepo.query(
      `SELECT DISTINCT ON (booking_id, status) booking_id, status, created_at
         FROM booking_status_history
        WHERE booking_id = ANY($1::uuid[])
          AND status IN ('paid', 'accepted', 'arriving', 'ongoing')
        ORDER BY booking_id, status, created_at DESC`,
      [ids],
    );
    for (const row of rows) map.set(key(row.booking_id, row.status), new Date(row.created_at));
    return map;
  }

  /** A plan's visit being worked on, else its earliest one still to do. Bookings without visits aren't plans. */
  private async nextVisits(ids: string[]) {
    const map = new Map<string, { date: string; time: string }>();
    if (!ids.length) return map;
    const rows: { booking_id: string; visit_date: string; start_time: string }[] = await this.bookingRepo.query(
      `SELECT DISTINCT ON (booking_id) booking_id,
              to_char(visit_date, 'YYYY-MM-DD') AS visit_date,
              start_time::text AS start_time
         FROM booking_visits
        WHERE booking_id = ANY($1::uuid[])
          AND status IN ('pending', 'active')
        ORDER BY booking_id, (status = 'active') DESC, visit_date, start_time`,
      [ids],
    );
    for (const row of rows) map.set(row.booking_id, { date: row.visit_date, time: row.start_time });
    return map;
  }

  private async dispatchesOf(ids: string[]) {
    if (!ids.length) return new Map<string, BookingDispatch>();
    const rows = await this.dispatchRepo.find({ where: { bookingId: In(ids) } });
    return new Map(rows.map((row) => [row.bookingId, row]));
  }

  private async offerStats(ids: string[]) {
    const map = new Map<string, OfferStats>();
    if (!ids.length) return map;
    // wave 0 rows only record an agent who passed on (or gave back) the job; they were never
    // offered it. A release resets the dispatch's created_at, so offers before it belong to the
    // previous broadcast.
    const rows: {
      booking_id: string;
      offered: number;
      pending: number;
      declined: number;
      first_offer_at: Date | null;
    }[] = await this.bookingRepo.query(
      `SELECT o.booking_id,
              COUNT(*) FILTER (WHERE o.wave > 0)::int AS offered,
              COUNT(*) FILTER (WHERE o.status = 'pending' AND o.expires_at > now())::int AS pending,
              COUNT(*) FILTER (WHERE o.status = 'declined')::int AS declined,
              MIN(o.created_at) FILTER (
                WHERE o.wave > 0 AND (d.created_at IS NULL OR o.created_at >= d.created_at)
              ) AS first_offer_at
         FROM booking_offers o
         LEFT JOIN booking_dispatches d ON d.booking_id = o.booking_id
        WHERE o.booking_id = ANY($1::uuid[])
        GROUP BY o.booking_id`,
      [ids],
    );
    for (const row of rows) {
      map.set(row.booking_id, {
        offered: Number(row.offered),
        pending: Number(row.pending),
        declined: Number(row.declined),
        firstOfferAt: row.first_offer_at ? new Date(row.first_offer_at) : null,
      });
    }
    return map;
  }

  /** Latest routed ETA per job on the way (booking_etas is created by BookingEtaService; absent on a fresh DB). */
  private async etasOf(ids: string[]) {
    const map = new Map<string, Eta>();
    if (!ids.length) return map;
    try {
      const rows: { booking_id: string; eta_minutes: number; computed_at: Date }[] = await this.bookingRepo.query(
        `SELECT booking_id, eta_minutes, computed_at FROM booking_etas WHERE booking_id = ANY($1::uuid[])`,
        [ids],
      );
      for (const row of rows) {
        map.set(row.booking_id, { etaMinutes: Number(row.eta_minutes), computedAt: new Date(row.computed_at) });
      }
    } catch (err) {
      this.logger.warn(`Booking ETAs unavailable: ${(err as Error).message}`);
    }
    return map;
  }

  /** Reminders and warnings the held-job watcher already sent (booking_job_alerts), newest first. */
  private async nudgesOf(ids: string[]) {
    const map = new Map<string, Nudge[]>();
    if (!ids.length) return map;
    try {
      const rows: { booking_id: string; agent_id: string; kind: string; created_at: Date }[] =
        await this.bookingRepo.query(
          `SELECT booking_id, agent_id, kind, created_at
             FROM booking_job_alerts
            WHERE booking_id = ANY($1::uuid[])
              AND kind IN ('reminder', 'warning', 'no_location')
              AND created_at > now() - make_interval(hours => $2)
            ORDER BY created_at DESC`,
          [ids, LOOKBACK_HOURS],
        );
      for (const row of rows) {
        map.set(row.booking_id, [
          ...(map.get(row.booking_id) ?? []),
          { agentId: row.agent_id, kind: row.kind, at: new Date(row.created_at) },
        ]);
      }
    } catch (err) {
      this.logger.warn(`Job alerts unavailable: ${(err as Error).message}`);
    }
    return map;
  }

  /** Nudges to the agent who holds the job now, latest of each kind. */
  private nudgesFor(booking: Booking, ctx: Context) {
    const seen = new Set<string>();
    return (ctx.nudges.get(booking.id) ?? []).filter((nudge) => {
      if (nudge.agentId !== booking.agentId || seen.has(nudge.kind)) return false;
      seen.add(nudge.kind);
      return true;
    });
  }

  /** Approved, unsuspended agents this admin can see, plus anyone holding a job on the board. */
  private async agentsInScope(jobAgents: Agent[]) {
    const qb = this.agentRepo
      .createQueryBuilder('agent')
      .leftJoinAndSelect('agent.user', 'user')
      .leftJoinAndSelect('agent.homeZone', 'homeZone')
      .where("agent.approvalStatus = 'APPROVED'")
      .andWhere("agent.status <> 'SUSPENDED'");
    this.access.restrictAgent(qb, 'agent');
    const agents = await qb.getMany();
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    for (const agent of jobAgents) {
      if (!byId.has(agent.id)) byId.set(agent.id, agent);
    }
    return [...byId.values()];
  }

  /** Online = switched on for today in the agent app, and inside the hours they set for today. */
  private async presenceOf(agents: Agent[], now: Date) {
    const map = new Map<string, AgentPresence>();
    if (!agents.length) return map;
    const rows = await this.availabilityRepo.find({
      where: { agentId: In(agents.map((agent) => agent.id)), availabilityDate: todayString() },
      order: { createdAt: 'DESC' },
    });
    const dayOf = new Map<string, AgentAvailability>();
    for (const row of rows) {
      if (!dayOf.has(row.agentId)) dayOf.set(row.agentId, row);
    }
    const minutes = now.getHours() * 60 + now.getMinutes();
    for (const agent of agents) {
      const day = dayOf.get(agent.id);
      if (!day) {
        map.set(agent.id, NOT_ONLINE_TODAY);
      } else if (!day.isAvailable) {
        map.set(agent.id, { state: 'offline', label: 'Offline today', jobLabel: 'Agent is offline today' });
      } else if (day.startTime && minutes < toMinutes(day.startTime)) {
        const at = clockOfTime(day.startTime);
        map.set(agent.id, {
          state: 'off_hours',
          label: `Working hours start at ${at}`,
          jobLabel: `Agent's working hours start at ${at}`,
        });
      } else if (day.endTime && minutes > toMinutes(day.endTime)) {
        const at = clockOfTime(day.endTime);
        map.set(agent.id, {
          state: 'off_hours',
          label: `Working hours ended at ${at}`,
          jobLabel: `Agent's working hours ended at ${at}`,
        });
      } else {
        map.set(agent.id, { state: 'online', label: 'Online', jobLabel: 'Agent is online' });
      }
    }
    return map;
  }

  private distanceKm(booking: Booking) {
    const fix = booking.agent?.currentLocation;
    const address = booking.address;
    if (!fix || !address) return null;
    const points = [fix.latitude, fix.longitude, address.latitude, address.longitude].map(Number);
    if (points.some((value) => !Number.isFinite(value))) return null;
    const [lat1, lng1, lat2, lng2] = points;
    return Math.round(haversineKm(lat1, lng1, lat2, lng2) * 10) / 10;
  }
}

function key(bookingId: string, status: string) {
  return `${bookingId}:${status}`;
}

/**
 * How late a scheduled job's broadcast can legitimately be: it goes out on
 * the first dispatch tick after its lead time, so one tick (DISPATCH_TICK_MS,
 * or the request-driven DISPATCH_REQUEST_TICK_SECONDS without a timer) plus a minute.
 */
function broadcastGraceMinutes() {
  const tickMs = Number(process.env.DISPATCH_TICK_MS);
  if (Number.isFinite(tickMs) && tickMs > 0) return Math.ceil(tickMs / 60_000) + 1;
  const requestSeconds = Number(process.env.DISPATCH_REQUEST_TICK_SECONDS);
  const seconds = Number.isFinite(requestSeconds) && requestSeconds > 0 ? requestSeconds : 20;
  return Math.ceil(seconds / 60) + 1;
}

function fullName(firstName: string | null | undefined, lastName: string | null | undefined) {
  return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
}

function clock(value: Date) {
  const hours = value.getHours();
  return `${hours % 12 || 12}:${String(value.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** 'HH:MM[:SS]' → '9:00 AM'. */
function clockOfTime(time: string) {
  const total = toMinutes(time);
  const at = new Date();
  at.setHours(Math.floor(total / 60), total % 60, 0, 0);
  return clock(at);
}

function minutesText(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}
