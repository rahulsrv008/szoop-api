import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Factory, Harness, area, asSuperAdmin, at, north, reload, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { DispatchService } from 'src/dispatch/dispatch.service';
import { HeldJobsService } from 'src/dispatch/held-jobs.service';
import { CustomerBookingsService } from 'src/customer/bookings/bookings.service';
import { CustomerTrackingService } from 'src/customer/tracking/tracking.service';
import { AdminMissedJobsService } from 'src/admin/missed-jobs/missed-jobs.service';

describe('Held jobs: reminders and no-shows', () => {
  let h: Harness;
  let f: Factory;
  let dispatch: DispatchService;
  let cleaning: E.Service;
  let skill: E.Skill;
  let customer: E.Customer;
  let customerUser: E.User;

  before(async () => {
    h = await startApp();
    f = new Factory(h);
    dispatch = h.get(DispatchService);
    cleaning = await f.service('Home Cleaning');
    skill = await f.skill('Cleaning', 'cleaning');
    ({ user: customerUser, customer } = await f.customer());
  });
  after(() => h.close());

  /** A job held by `agentId`, accepted `acceptedMinutesAgo` ago, starting `startsIn` minutes from now. */
  const held = async (
    index: number,
    name: string,
    startsIn: number,
    options: { status?: E.Booking['status']; acceptedMinutesAgo?: number } = {},
  ) => {
    const base = area(index);
    const agent = await f.agent(name, { live: base, skills: [skill] });
    const booking = await f.booking({
      customerId: customer.id,
      service: cleaning,
      point: base,
      when: at(startsIn),
      status: options.status ?? 'accepted',
      agentId: agent.id,
    });
    const history = await h.repo(E.BookingStatusHistory).save({
      bookingId: booking.id,
      status: 'accepted',
      changedBy: agent.userId,
      remarks: 'Accepted by agent',
    } as never);
    await h
      .repo(E.BookingStatusHistory)
      .update({ id: (history as unknown as { id: string }).id }, { createdAt: new Date(Date.now() - (options.acceptedMinutesAgo ?? 120) * 60_000) });
    return { agent, booking };
  };

  const agentNotices = (userId: string, title: string) =>
    h.repo(E.Notification).count({ where: { userId, title } });
  const tickets = (bookingId: string) =>
    h.repo(E.SupportTicket).find({ where: { bookingId } });

  it('reminds the agent once, about an hour before the start', async () => {
    const { agent, booking } = await held(1, 'reminded', 50);
    await dispatch.tick();
    await dispatch.tick();
    assert.equal(await agentNotices(agent.userId, 'Start heading to the customer'), 1);
    assert.equal((await reload(h, booking.id)).status, 'accepted');
  });

  it('warns 10 minutes before the cut-off that the job will go to someone else', async () => {
    const { agent, booking } = await held(2, 'warned', 22);
    await dispatch.tick();
    assert.equal(await agentNotices(agent.userId, `Tap "I'm on my way" now`), 1);
    assert.equal((await reload(h, booking.id)).agentId, agent.id);
  });

  it('no "on my way" 15 minutes before the start: back to dispatch, counted, admin ticket', async () => {
    const { agent, booking } = await held(3, 'no-show', 10);
    await dispatch.tick();
    const after = await reload(h, booking.id);
    assert.equal(after.agentId, null);
    assert.equal(after.status, 'paid', 'back in the pool while there is still time');
    assert.equal(await dispatch.recentReleases(agent.id, 30), 1, 'counts against the release limit');
    assert.ok(await h.repo(E.Notification).findOneBy({ userId: agent.userId, title: 'Job removed' }));
    assert.ok(await h.repo(E.Notification).findOneBy({ userId: customerUser.id, title: 'Finding you a new expert' }));
    const [ticket] = await tickets(booking.id);
    assert.equal(ticket?.priority, 'HIGH');
  });

  it('a job accepted late gets 15 minutes from accepting before it is taken back', async () => {
    const { agent, booking } = await held(4, 'late-accept', 10, { acceptedMinutesAgo: 1 });
    await dispatch.tick();
    assert.equal((await reload(h, booking.id)).agentId, agent.id);
  });

  it('released for a no-show and nobody took it by the start: closed and the customer told', async () => {
    const { booking } = await held(5, 'too-late', -5);
    await dispatch.tick();
    assert.equal((await reload(h, booking.id)).status, 'expired');
    assert.ok(await h.repo(E.Notification).findOneBy({ userId: customerUser.id, title: 'No expert available' }));
  });

  it('on the way but not started 30 minutes after the start: cancelled, counted, everyone told', async () => {
    const { agent, booking } = await held(6, 'never-started', -35, { status: 'arriving' });
    await dispatch.tick();
    const after = await reload(h, booking.id);
    assert.equal(after.status, 'cancelled');
    assert.equal(await dispatch.recentReleases(agent.id, 30), 1);
    assert.ok(await h.repo(E.Notification).findOneBy({ userId: agent.userId, title: 'Booking cancelled' }));
    assert.ok(await h.repo(E.Notification).findOneBy({ userId: customerUser.id, title: 'Booking cancelled' }));
    assert.equal((await tickets(booking.id)).length, 1);
  });

  it('on the way and still within 30 minutes of the start: left alone', async () => {
    const { agent, booking } = await held(7, 'on-the-way', -20, { status: 'arriving' });
    await dispatch.tick();
    const after = await reload(h, booking.id);
    assert.equal(after.status, 'arriving');
    assert.equal(after.agentId, agent.id);
  });

  it('a plan visit not started is flagged, never released or cancelled', async () => {
    const { agent, booking } = await held(8, 'cook', -35);
    const slot = at(-35);
    await h.repo(E.Booking).update({ id: booking.id }, { planType: 'MONTHLY' });
    await h.repo(E.BookingVisit).save({
      bookingId: booking.id,
      visitDate: slot.date,
      shift: 'morning',
      startTime: slot.time,
      otp: '4321',
      status: 'pending',
    } as never);
    await dispatch.tick();
    const after = await reload(h, booking.id);
    assert.equal(after.status, 'accepted');
    assert.equal(after.agentId, agent.id);
    assert.ok(await h.repo(E.Notification).findOneBy({ userId: agent.userId, title: 'Visit missed' }));
    assert.equal((await tickets(booking.id))[0]?.subject, `Missed job · ${booking.bookingNumber}`);
  });

  it('"Right now": no hour-before reminder, a nudge 5 minutes after accepting, taken back at 15, refunded an hour after its start', async () => {
    // Booked ~18 minutes ago for a slot 3 minutes ago, accepted 4 minutes after booking.
    const nudged = await held(10, 'instant-nudged', 10, { acceptedMinutesAgo: 6 });
    await h.repo(E.Booking).update({ id: nudged.booking.id }, { bookingMode: 'INSTANT' });
    const late = await held(11, 'instant-late', -3, { acceptedMinutesAgo: 16 });
    await h.repo(E.Booking).update({ id: late.booking.id }, { bookingMode: 'INSTANT' });

    await dispatch.tick();
    assert.equal(await agentNotices(nudged.agent.userId, 'Start heading to the customer'), 0, 'accepted after that time');
    assert.equal(await agentNotices(nudged.agent.userId, `Tap "I'm on my way" now`), 1);
    assert.equal((await reload(h, nudged.booking.id)).agentId, nudged.agent.id);

    // Taken off the agent and back out to everyone else, though its slot has passed:
    // a "Right now" job is still offered until an hour after its start.
    assert.equal((await reload(h, late.booking.id)).status, 'paid');
    assert.ok(await h.repo(E.Notification).findOneBy({ userId: late.agent.userId, title: 'Job removed' }));

    // Nobody takes it by then: it expires (and whatever was paid goes back to the customer).
    const gone = at(-61);
    await h.repo(E.Booking).update({ id: late.booking.id }, { bookingDate: gone.date, startTime: gone.time });
    await h.ds.query(`UPDATE booking_dispatches SET next_action_at = now() WHERE booking_id = $1`, [late.booking.id]);
    await dispatch.tick();
    assert.equal((await reload(h, late.booking.id)).status, 'expired');
  });

  describe('"Right now": is the agent actually moving?', () => {
    /** On the way to a "Right now" job for `minutesOnTheWay`, set off `startKm` from the customer. */
    const onTheWay = async (index: number, name: string, minutesOnTheWay: number, startKm: number) => {
      const job = await held(index, name, 5, { status: 'arriving', acceptedMinutesAgo: minutesOnTheWay + 1 });
      await h.repo(E.Booking).update({ id: job.booking.id }, { bookingMode: 'INSTANT' });
      const history = await h.repo(E.BookingStatusHistory).save({
        bookingId: job.booking.id,
        status: 'arriving',
        changedBy: job.agent.userId,
        remarks: 'On the way',
      } as never);
      await h
        .repo(E.BookingStatusHistory)
        .update({ id: (history as unknown as { id: string }).id }, { createdAt: new Date(Date.now() - minutesOnTheWay * 60_000) });
      await ping(job.agent.id, startKm, minutesOnTheWay);
      return job;
    };
    /** Records a location update `km` north of the customer, `minutesAgo` ago (placed by placePings). */
    const ping = async (agentId: string, km: number, minutesAgo: number) => {
      const saved = await h.repo(E.AgentLocation).save({ agentId, latitude: '0', longitude: '0' } as never);
      pings.push({ id: (saved as unknown as { id: string }).id, agentId, km, minutesAgo });
    };
    const pings: { id: string; agentId: string; km: number; minutesAgo: number }[] = [];
    /** Moves each update to its distance north of that agent's customer and backdates it (recorded_at defaults to now). */
    const placePings = async (index: number, agentId: string) => {
      for (const p of pings.filter((row) => row.agentId === agentId)) {
        const point = north(area(index), p.km);
        await h.repo(E.AgentLocation).update(
          { id: p.id },
          { latitude: point.lat.toFixed(7), longitude: point.lng.toFixed(7), recordedAt: new Date(Date.now() - p.minutesAgo * 60_000) },
        );
      }
    };

    it('no closer after 10 minutes: back to dispatch with a new start, counted, admin ticket', async () => {
      const { agent, booking } = await onTheWay(12, 'parked', 11, 3);
      await ping(agent.id, 3, 1);
      await placePings(12, agent.id);
      await dispatch.tick();
      const after = await reload(h, booking.id);
      assert.equal(after.agentId, null);
      assert.equal(after.status, 'paid', 'open again for other agents');
      const restart = new Date(`${String(after.bookingDate).slice(0, 10)}T${after.startTime}`);
      assert.ok(restart.getTime() >= Date.now() + 14 * 60_000, `new start ${after.bookingDate} ${after.startTime}`);
      assert.equal(await dispatch.recentReleases(agent.id, 30), 1);
      assert.ok((await tickets(booking.id)).some((t) => t.description?.includes('moved') || t.description?.includes('km from the customer')));
    });

    it('closer than when they set off: left alone', async () => {
      const { agent, booking } = await onTheWay(13, 'driving', 11, 3);
      await ping(agent.id, 1.5, 1);
      await placePings(13, agent.id);
      await dispatch.tick();
      assert.equal((await reload(h, booking.id)).agentId, agent.id);
    });

    it('already at the customer: left alone', async () => {
      const { agent, booking } = await onTheWay(14, 'waiting-at-door', 11, 0.2);
      await ping(agent.id, 0.1, 1);
      await placePings(14, agent.id);
      await dispatch.tick();
      assert.equal((await reload(h, booking.id)).agentId, agent.id);
    });

    it('no location coming in (no internet, or behind Google Maps): asked once, nothing taken away', async () => {
      const { agent, booking } = await onTheWay(15, 'offline', 11, 3);
      await placePings(15, agent.id);
      await dispatch.tick();
      await dispatch.tick();
      assert.equal((await reload(h, booking.id)).agentId, agent.id);
      assert.equal(await dispatch.recentReleases(agent.id, 30), 0);
      assert.equal(await agentNotices(agent.userId, "We can't see your location"), 1);
      assert.equal((await tickets(booking.id)).length, 0, 'not a no-show: no admin ticket for this alone');
    });
  });

  describe('the customer\'s "Find another expert"', () => {
    const replace = (bookingId: string) => h.get(CustomerBookingsService).replaceExpert(customerUser.id, bookingId);
    const canReplace = async (bookingId: string) =>
      (await h.get(CustomerTrackingService).tracking(customerUser.id, bookingId)).canReplaceExpert;

    it('start time passed and not started: offered, then the job goes back out with a new start', async () => {
      const { agent, booking } = await held(16, 'running-late', -5, { status: 'arriving' });
      assert.equal(await canReplace(booking.id), true);

      const result = await replace(booking.id);
      assert.ok(new Date(result.newStartTime).getTime() >= Date.now() + 14 * 60_000);
      const after = await reload(h, booking.id);
      assert.equal(after.agentId, null);
      assert.equal(after.status, 'paid');
      assert.equal(await dispatch.recentReleases(agent.id, 30), 1, 'counts against the late expert');
      assert.ok(await h.repo(E.Notification).findOneBy({ userId: agent.userId, title: 'Job removed' }));
      assert.equal((await tickets(booking.id)).length, 1);

      // A second tap does nothing more.
      await assert.rejects(replace(booking.id), /already|start time/);
      assert.equal(await dispatch.recentReleases(agent.id, 30), 1);

      // Nobody takes it by the new start: closed and refunded to the wallet.
      const actions = (dispatch as unknown as { heldJobActions: () => never }).heldJobActions();
      await h.get(HeldJobsService).sweep(actions, new Date(Date.now() + 25 * 60_000));
      assert.equal((await reload(h, booking.id)).status, 'expired');
    });

    it('not offered before the start time', async () => {
      const { agent, booking } = await held(17, 'on-time', 30);
      assert.equal(await canReplace(booking.id), false);
      await assert.rejects(replace(booking.id), /start time/);
      assert.equal((await reload(h, booking.id)).agentId, agent.id);
    });

    it('not offered for a plan (it has "change cook")', async () => {
      const { booking } = await held(18, 'plan-cook', -5);
      const slot = at(-5);
      await h.repo(E.BookingVisit).save({
        bookingId: booking.id,
        visitDate: slot.date,
        shift: 'morning',
        startTime: slot.time,
        otp: '4321',
        status: 'pending',
      } as never);
      assert.equal(await canReplace(booking.id), false);
      await assert.rejects(replace(booking.id), /start time/);
    });
  });

  it('the admin panel lists missed jobs per agent, and a warning covers the unwarned ones', async () => {
    const admin = () => h.get(AdminMissedJobsService);
    // Two misses by one agent: didn't set off, then never started.
    const first = await held(19, 'repeat-offender', 10);
    await dispatch.tick();
    const second = await f.booking({
      customerId: customer.id,
      service: cleaning,
      point: area(19),
      when: at(-35),
      status: 'arriving',
      agentId: first.agent.id,
    });
    await dispatch.tick();
    assert.equal((await reload(h, second.id)).status, 'cancelled');

    const summary = await asSuperAdmin(() => admin().agents({ search: 'repeat-offender' }));
    const row = summary.items.find((item) => item.agentId === first.agent.id);
    assert.ok(row, 'listed');
    assert.equal(row.missed, 2);
    assert.equal(row.byReason.NO_ON_THE_WAY, 1);
    assert.equal(row.byReason.NOT_STARTED, 1);
    assert.equal(row.notWarned, 2);
    assert.equal(row.lastWarnedAt, null);

    const list = await asSuperAdmin(() => admin().list({ agentId: first.agent.id } as never));
    assert.equal(list.items.length, 2);
    assert.deepEqual(new Set(list.items.map((item) => item.bookingNumber)), new Set([first.booking.bookingNumber, second.bookingNumber]));
    assert.ok(list.items.every((item) => item.agentName && item.reasonLabel));

    const warned = await asSuperAdmin(() => admin().warn(randomUUID(), first.agent.id, {}));
    assert.equal(warned.warnedJobs, 2);
    assert.ok(warned.message.includes(first.booking.bookingNumber));
    assert.ok(await h.repo(E.Notification).findOneBy({ userId: first.agent.userId, title: 'Warning about missed jobs' }));

    const after = await asSuperAdmin(() => admin().agents({ search: 'repeat-offender' }));
    const again = after.items.find((item) => item.agentId === first.agent.id);
    assert.equal(again?.notWarned, 0);
    assert.ok(again?.lastWarnedAt);
  });

  it('a job missed hours ago is left for the admin, not swept up', async () => {
    const { agent, booking } = await held(9, 'long-ago', -5 * 60);
    await dispatch.tick();
    assert.equal((await reload(h, booking.id)).agentId, agent.id);
  });
});
