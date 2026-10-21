import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Factory, Harness, area, asSuperAdmin, at, rejectsWith, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { AdminAccess, adminAccessStore } from 'src/common/auth/admin-access';
import { todayString } from 'src/agent/shared/date.util';
import { AdminBookingMonitorService } from 'src/admin/booking-monitor/booking-monitor.service';
import { DEFAULT_MONITOR_RULES } from 'src/admin/booking-monitor/booking-monitor.rules';
import { scheduledDispatchLeadMinutes } from 'src/dispatch/dispatch.rules';

describe('Booking monitor', () => {
  let h: Harness;
  let f: Factory;
  let monitor: AdminBookingMonitorService;
  let cleaning: E.Service;
  let customerId: string;
  let lead: number;

  before(async () => {
    h = await startApp();
    f = new Factory(h);
    monitor = h.get(AdminBookingMonitorService);
    cleaning = await f.service('Home Cleaning');
    customerId = (await f.customer()).customer.id;
    lead = scheduledDispatchLeadMinutes();
  });
  after(() => h.close());

  const board = () => asSuperAdmin(() => monitor.board());
  const jobOf = async (bookingId: string) => (await board()).jobs.find((job) => job.id === bookingId);
  const agentRow = async (agentId: string) => (await board()).agents.find((row) => row.id === agentId);
  const asZoneAdmin = <T>(zoneIds: string[], fn: () => Promise<T>) =>
    adminAccessStore.run(
      { adminId: 'zone-admin', role: 'ADMIN', unrestricted: false, zoneIds } as AdminAccess,
      fn,
    );

  const secondsAgo = (minutes: number) => Math.round(minutes * 60);

  /** Back-dates when the booking entered `status`. */
  const enteredAt = (bookingId: string, status: string, minutesAgo: number) =>
    h.ds.query(
      `INSERT INTO booking_status_history (booking_id, status, created_at)
       VALUES ($1, $2, now() - make_interval(secs => $3))`,
      [bookingId, status, secondsAgo(minutesAgo)],
    );

  /**
   * What dispatch leaves behind when it offers a job to `agentId` `minutesAgo`. Its dispatch
   * row starts then too, unless `startedMinutesAgo` says otherwise (a scheduled job's row is
   * made at payment and only broadcast once its lead time comes round).
   */
  const broadcast = async (
    bookingId: string,
    agentId: string,
    minutesAgo: number,
    startedMinutesAgo = minutesAgo,
  ) => {
    await h.ds.query(
      `INSERT INTO booking_dispatches (booking_id, status, wave, next_action_at, created_at)
       VALUES ($1, 'searching', 1, now() + interval '1 minute', now() - make_interval(secs => $2))
       ON CONFLICT (booking_id) DO UPDATE SET status = 'searching', wave = 1, created_at = EXCLUDED.created_at`,
      [bookingId, secondsAgo(startedMinutesAgo) + 1],
    );
    await h.ds.query(
      `INSERT INTO booking_offers (booking_id, agent_id, wave, status, expires_at, created_at)
       VALUES ($1, $2, 1, 'pending', now() + interval '90 seconds', now() - make_interval(secs => $3))`,
      [bookingId, agentId, secondsAgo(minutesAgo)],
    );
  };

  /** Switched on for the whole of today in the agent app. */
  const online = (agentId: string) =>
    f.unavailable(agentId, todayString(), { from: '00:00:00', to: '23:59:59' });

  /** A zone with one agent online in it, so "nobody online" doesn't colour its jobs. */
  const staffedZone = async () => {
    const zone = await f.zone();
    const helper = await f.agent(`helper-${zone.name}`, { zones: [zone.id] });
    await online(helper.id);
    return { zone, helper };
  };

  const job = (options: {
    zoneId: string;
    minutesFromNow: number;
    status?: E.Booking['status'];
    agentId?: string;
    instant?: boolean;
  }) =>
    f
      .booking({
        customerId,
        service: cleaning,
        point: area(1),
        when: at(options.minutesFromNow),
        zoneId: options.zoneId,
        status: options.status ?? 'paid',
        agentId: options.agentId ?? null,
      })
      .then(async (booking) => {
        await h.repo(E.Booking).update(booking.id, {
          bookingMode: options.instant ? 'INSTANT' : 'SCHEDULED',
        });
        return booking;
      });

  describe('waiting for an agent', () => {
    it('is timed from the broadcast: orange at 3 minutes, red at 5', async () => {
      const { zone, helper } = await staffedZone();
      const sentOut = async (minutesAgo: number) => {
        const booking = await job({ zoneId: zone.id, minutesFromNow: 10, instant: true });
        await enteredAt(booking.id, 'paid', minutesAgo);
        await broadcast(booking.id, helper.id, minutesAgo);
        return booking;
      };
      const [fresh, late, critical] = [await sentOut(1), await sentOut(4), await sentOut(6)];

      const view = await jobOf(late.id);
      assert.equal(view?.step, 'WAITING_FOR_AGENT');
      assert.match(view?.note ?? '', /^broadcast /);
      assert.equal(view?.nextAction?.label, 'Expires and the customer is refunded');
      assert.equal((await jobOf(fresh.id))?.severity, 'ok');
      assert.equal(view?.severity, 'orange');
      assert.equal((await jobOf(critical.id))?.severity, 'red');
    });

    it('tracks a scheduled job from when it actually went out, not from payment', async () => {
      const { zone, helper } = await staffedZone();
      // Paid (and its dispatch started) two hours ago; broadcast a minute ago, by a tick that ran 3 minutes late.
      const lateTick = await job({ zoneId: zone.id, minutesFromNow: lead - 4 });
      await enteredAt(lateTick.id, 'paid', 120);
      await broadcast(lateTick.id, helper.id, 1, 120);
      // Not due to go out for another 55 minutes: nothing to track yet.
      const notYet = await job({ zoneId: zone.id, minutesFromNow: lead + 55 });
      await enteredAt(notYet.id, 'paid', 120);

      const view = await jobOf(lateTick.id);
      assert.equal(view?.running, true);
      assert.equal(view?.severity, 'ok');
      assert.equal(await jobOf(notYet.id), undefined);
    });

    it('is red when it was due to go out and never did', async () => {
      const { zone } = await staffedZone();
      const stuck = await job({ zoneId: zone.id, minutesFromNow: lead - 10 });
      await enteredAt(stuck.id, 'paid', 120);

      const view = await jobOf(stuck.id);
      assert.equal(view?.severity, 'red');
      assert.ok(view?.flags.some((flag) => flag.code === 'NOT_BROADCAST'));
    });

    it('restarts the timer when the job is broadcast again after a release', async () => {
      const { zone, helper } = await staffedZone();
      const other = await f.agent('let-it-go', { zones: [zone.id] });
      const booking = await job({ zoneId: zone.id, minutesFromNow: 20 });
      await enteredAt(booking.id, 'paid', 30);
      await broadcast(booking.id, other.id, 30);
      await h.ds.query(`UPDATE booking_offers SET status = 'declined' WHERE booking_id = $1`, [booking.id]);
      // Released and sent out again 2 minutes ago.
      await enteredAt(booking.id, 'paid', 2);
      await broadcast(booking.id, helper.id, 2);

      assert.equal((await jobOf(booking.id))?.severity, 'ok');
    });

    it('"Right now": stays red from its start until the hour is up and it is refunded', async (t) => {
      if (at(-30).date !== at(0).date) return t.skip('the start would fall before midnight');
      const { zone, helper } = await staffedZone();
      // Started half an hour ago and still nobody's: a fresh broadcast a minute
      // ago must not calm it down while the customer is waiting on a refund.
      const booking = await job({ zoneId: zone.id, minutesFromNow: -30, instant: true });
      await enteredAt(booking.id, 'paid', 1);
      await broadcast(booking.id, helper.id, 1);

      const view = await jobOf(booking.id);
      assert.equal(view?.step, 'WAITING_FOR_AGENT');
      assert.equal(view?.severity, 'red');
      assert.ok(view?.flags.some((flag) => flag.code === 'START_PASSED'));
      assert.equal(view?.nextAction?.label, 'Expires and the customer is refunded');
      const start = Date.parse(`${at(-30).date}T${at(-30).time}`);
      assert.equal(Date.parse(view!.nextAction!.at!), start + 60 * 60_000);
    });

    it('is orange straight away when nobody is online in its zone', async () => {
      const empty = await f.zone();
      const elsewhere = await f.agent('elsewhere');
      const booking = await job({ zoneId: empty.id, minutesFromNow: 10, instant: true });
      await enteredAt(booking.id, 'paid', 0.5);
      await broadcast(booking.id, elsewhere.id, 0.5);

      const before = await jobOf(booking.id);
      assert.equal(before?.severity, 'orange');
      assert.ok(before?.flags.some((flag) => flag.code === 'NO_AGENTS_ONLINE'));

      await online((await f.agent('arrives', { zones: [empty.id] })).id);
      const after = await jobOf(booking.id);
      assert.equal(after?.severity, 'ok');
      assert.ok(!after?.flags.some((flag) => flag.code === 'NO_AGENTS_ONLINE'));
    });
  });

  describe("agent hasn't set off", () => {
    it('is timed from when the agent picked it', async () => {
      const { zone } = await staffedZone();
      const agent = await f.agent('picker', { zones: [zone.id] });
      await online(agent.id);
      const picked = async (minutesAgo: number) => {
        const booking = await job({ zoneId: zone.id, minutesFromNow: 30, status: 'accepted', agentId: agent.id });
        await enteredAt(booking.id, 'accepted', minutesAgo);
        return booking;
      };
      const [justNow, late, critical] = [await picked(1), await picked(4), await picked(6)];

      const view = await jobOf(late.id);
      assert.equal(view?.step, 'NOT_SET_OFF');
      assert.match(view?.note ?? '', /^picked /);
      assert.equal(view?.nextAction?.label, 'Goes to another agent');
      assert.equal((await jobOf(justNow.id))?.severity, 'ok');
      assert.equal(view?.severity, 'orange');
      assert.equal((await jobOf(critical.id))?.severity, 'red');
    });

    it('is not tracked before its broadcast time when an admin assigned it early', async () => {
      const { zone } = await staffedZone();
      const agent = await f.agent('early-bird', { zones: [zone.id] });
      await online(agent.id);
      const booking = await job({ zoneId: zone.id, minutesFromNow: lead + 60, status: 'accepted', agentId: agent.id });
      await enteredAt(booking.id, 'accepted', 180);
      assert.equal(await jobOf(booking.id), undefined);
    });

    it('flags an agent who is not online orange while their job later today is not live yet', async (t) => {
      if (at(lead + 60).date !== at(0).date) return t.skip('the job would fall after midnight');
      const { zone } = await staffedZone();
      const later = await f.agent('later-today', { zones: [zone.id] });
      const laterJob = await job({ zoneId: zone.id, minutesFromNow: lead + 60, status: 'accepted', agentId: later.id });
      await enteredAt(laterJob.id, 'accepted', 180);

      const laterRow = await agentRow(later.id);
      assert.equal(laterRow?.severity, 'orange');
      assert.equal(laterRow?.presence, 'offline');
      assert.equal(laterRow?.nextJob?.bookingId, laterJob.id);
      assert.match(laterRow?.alert?.reason ?? '', /^Hasn't come online today · should set off by /);
    });

    it('turns an agent who is not online red once their job is live, and flags the job', async (t) => {
      if (at(30).date !== at(0).date) return t.skip('the job would fall after midnight');
      const { zone } = await staffedZone();
      const now = await f.agent('needed-now', { zones: [zone.id] });
      const nowJob = await job({ zoneId: zone.id, minutesFromNow: 30, status: 'accepted', agentId: now.id });
      await enteredAt(nowJob.id, 'accepted', 2);

      const view = await jobOf(nowJob.id);
      assert.equal(view?.severity, 'orange', 'picked 2 min ago, but the agent is offline');
      assert.ok(view?.flags.some((flag) => flag.label === "Agent hasn't come online today"));
      assert.equal((await agentRow(now.id))?.severity, 'red');
    });
  });

  describe('on the way', () => {
    it('is timed from the start: orange 3 minutes late, red at 5', async () => {
      const { zone } = await staffedZone();
      const agent = await f.agent('driver', { zones: [zone.id] });
      await online(agent.id);
      const going = async (minutesFromNow: number) => {
        const booking = await job({ zoneId: zone.id, minutesFromNow, status: 'arriving', agentId: agent.id });
        await enteredAt(booking.id, 'arriving', 20);
        return booking;
      };
      const [onTime, late, critical] = [await going(10), await going(-4), await going(-6)];

      assert.equal((await jobOf(onTime.id))?.severity, 'ok');
      assert.equal((await jobOf(late.id))?.severity, 'orange');
      const view = await jobOf(critical.id);
      assert.equal(view?.step, 'ON_THE_WAY');
      assert.equal(view?.severity, 'red');
      assert.equal(view?.nextAction?.label, 'Cancels and refunds the customer');
      assert.ok(view?.flags.some((flag) => flag.code === 'NO_LOCATION'));
    });
  });

  describe('in progress', () => {
    it('runs over the booked time: orange after 10 minutes, red after 20', async () => {
      const { zone } = await staffedZone();
      const agent = await f.agent('cleaner', { zones: [zone.id] });
      await online(agent.id);
      const started = async (minutesAgo: number) => {
        const booking = await job({ zoneId: zone.id, minutesFromNow: -minutesAgo, status: 'ongoing', agentId: agent.id });
        await enteredAt(booking.id, 'ongoing', minutesAgo);
        return booking;
      };
      const [working, over, wayOver] = [await started(30), await started(75), await started(85)];

      assert.equal((await jobOf(working.id))?.severity, 'ok');
      assert.equal((await jobOf(over.id))?.severity, 'orange');
      assert.equal((await jobOf(wayOver.id))?.severity, 'red');
      assert.equal((await agentRow(agent.id))?.currentJob?.step, 'IN_PROGRESS');
    });
  });

  describe('zones', () => {
    it("shows a zone admin only their zone's jobs and agents", async () => {
      const mine = await staffedZone();
      const theirs = await staffedZone();
      const inMine = await job({ zoneId: mine.zone.id, minutesFromNow: 10, instant: true });
      await broadcast(inMine.id, mine.helper.id, 1);
      const inTheirs = await job({ zoneId: theirs.zone.id, minutesFromNow: 10, instant: true });
      await broadcast(inTheirs.id, theirs.helper.id, 1);
      // From another zone, but working a job in mine.
      const visitor = await f.agent('visitor', { zones: [theirs.zone.id] });
      await job({ zoneId: mine.zone.id, minutesFromNow: -10, status: 'ongoing', agentId: visitor.id });

      const scoped = await asZoneAdmin([mine.zone.id], () => monitor.board());
      assert.ok(scoped.jobs.some((view) => view.id === inMine.id));
      assert.ok(!scoped.jobs.some((view) => view.id === inTheirs.id));
      const agentIds = scoped.agents.map((row) => row.id);
      assert.ok(agentIds.includes(mine.helper.id));
      assert.ok(agentIds.includes(visitor.id), 'holds a job in my zone');
      assert.ok(!agentIds.includes(theirs.helper.id));
    });

    it("only lets a zone admin nudge agents in their zones, or on their zones' jobs", async () => {
      const mine = await staffedZone();
      const theirs = await staffedZone();
      const visitor = await f.agent('nudge-visitor', { zones: [theirs.zone.id] });
      const visitJob = await job({ zoneId: mine.zone.id, minutesFromNow: 20, status: 'accepted', agentId: visitor.id });
      const elsewhereJob = await job({ zoneId: theirs.zone.id, minutesFromNow: 20, status: 'accepted', agentId: visitor.id });
      const adminId = (await f.admin()).id;
      const nudge = (agentId: string, bookingId?: string) =>
        asZoneAdmin([mine.zone.id], () =>
          monitor.nudge(adminId, {
            agentId,
            bookingId,
            title: 'Time to head out',
            message: 'Tap "I\'m on my way" when you leave.',
          }),
        );

      assert.deepEqual(await nudge(mine.helper.id), { sent: true });
      assert.deepEqual(await nudge(visitor.id, visitJob.id), { sent: true });
      await rejectsWith(nudge(theirs.helper.id), 404);
      await rejectsWith(nudge(visitor.id), 404);
      await rejectsWith(nudge(visitor.id, elsewhereJob.id), 404);

      const sent = await h.repo(E.Notification).find({ where: { userId: visitor.userId } });
      assert.equal(sent.length, 1);
      assert.equal(sent[0].title, 'Time to head out');
    });
  });

  describe('rules', () => {
    let adminId: string;
    before(async () => {
      adminId = (await f.admin()).id;
    });
    after(() => asSuperAdmin(() => monitor.updateRules(adminId, { ...DEFAULT_MONITOR_RULES })));

    it('uses the thresholds a super admin sets', async () => {
      const { zone, helper } = await staffedZone();
      const booking = await job({ zoneId: zone.id, minutesFromNow: 10, instant: true });
      await enteredAt(booking.id, 'paid', 1.5);
      await broadcast(booking.id, helper.id, 1.5);
      assert.equal((await jobOf(booking.id))?.severity, 'ok');

      const rules = await asSuperAdmin(() =>
        monitor.updateRules(adminId, { waitingOrangeMinutes: 1, waitingRedMinutes: 2 }),
      );
      assert.equal(rules.waitingOrangeMinutes, 1);
      assert.equal(rules.setOffRedMinutes, DEFAULT_MONITOR_RULES.setOffRedMinutes, 'others unchanged');
      assert.equal((await jobOf(booking.id))?.severity, 'orange');
    });

    it('refuses red before orange', async () => {
      await rejectsWith(
        asSuperAdmin(() => monitor.updateRules(adminId, { arrivalOrangeMinutes: 5, arrivalRedMinutes: 3 })),
        400,
      );
    });

    it('is for super admins only', async () => {
      await rejectsWith(
        asZoneAdmin([], () => monitor.updateRules(adminId, { waitingRedMinutes: 9 })),
        403,
      );
    });
  });
});
