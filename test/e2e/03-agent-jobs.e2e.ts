import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Factory, Harness, area, at, dayOffset, north, offersOf, reload, rejectsWith, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { DispatchService } from 'src/dispatch/dispatch.service';
import { AgentBookingsService } from 'src/agent/bookings/bookings.service';
import { AgentAvailabilityService } from 'src/agent/availability/availability.service';
import { CustomerBookingsService } from 'src/customer/bookings/bookings.service';

describe('Agent jobs', () => {
  let h: Harness;
  let f: Factory;
  let dispatch: DispatchService;
  let jobs: AgentBookingsService;
  let availability: AgentAvailabilityService;
  let customerBookings: CustomerBookingsService;
  let cleaning: E.Service;
  let cooking: E.Service;
  let skill: E.Skill;
  let customer: E.Customer;
  let customerUser: E.User;

  before(async () => {
    h = await startApp();
    f = new Factory(h);
    dispatch = h.get(DispatchService);
    jobs = h.get(AgentBookingsService);
    availability = h.get(AgentAvailabilityService);
    customerBookings = h.get(CustomerBookingsService);
    cleaning = await f.service('Home Cleaning');
    cooking = await f.service('Cooking');
    skill = await f.skill('Cleaning', 'cleaning');
    ({ user: customerUser, customer } = await f.customer());
  });
  after(() => h.close());

  const job = (point: { lat: number; lng: number } | null, extra: Partial<Parameters<Factory['booking']>[0]> = {}) =>
    f.booking({
      customerId: customer.id,
      service: cleaning,
      point,
      when: { date: dayOffset(1), time: '10:00:00' },
      ...extra,
    });
  const available = async (userId: string, query: Record<string, unknown> = {}) =>
    (await jobs.list(userId, { scope: 'available', ...query } as never)) as unknown as {
      items: { id: string; distanceKm: number | null; offerExpiresAt: string | null; address: { latitude: number; addressLine1?: string } }[];
      meta: { total: number };
    };

  describe('the open-jobs list', () => {
    const base = area(1);
    let agent: E.Agent;
    const ids: Record<string, string> = {};

    before(async () => {
      const zone = await f.zone();
      agent = await f.agent('lister', { live: base, skills: [skill], zones: [zone.id] });
      const tomorrow = dayOffset(1);
      ids.inZoneFar = (await job(north(base, 20), { zoneId: zone.id })).id;
      ids.near2km = (await job(north(base, 2))).id;
      ids.far4km = (await job(north(base, 4))).id;
      ids.noPin = (await job(null)).id;
      ids.unskilled = (await job(north(base, 1), { service: cooking, when: { date: tomorrow, time: '15:00:00' } })).id;
      ids.hourlyUnskilled = (await job(north(base, 1), { service: cooking, planType: 'HOURLY', when: { date: tomorrow, time: '15:00:00' } })).id;
      ids.past = (await job(north(base, 1), { when: at(-120) })).id;
      // A job the agent holds at 10:00 → 11:00, plus 30 min travel buffer either side.
      const held = dayOffset(2);
      await job(north(base, 1), { status: 'accepted', agentId: agent.id, when: { date: held, time: '10:00:00' } });
      ids.clash = (await job(north(base, 1), { when: { date: held, time: '10:30:00' } })).id;
      ids.inBuffer = (await job(north(base, 1), { when: { date: held, time: '11:15:00' } })).id;
      ids.afterBuffer = (await job(north(base, 1), { when: { date: held, time: '11:30:00' } })).id;
      await f.unavailable(agent.id, dayOffset(3));
      ids.dayOff = (await job(north(base, 1), { when: { date: dayOffset(3), time: '10:00:00' } })).id;
      await f.unavailable(agent.id, dayOffset(4), { from: '09:00:00', to: '13:00:00' });
      ids.inHours = (await job(north(base, 1), { when: { date: dayOffset(4), time: '11:00:00' } })).id;
      ids.outOfHours = (await job(north(base, 1), { when: { date: dayOffset(4), time: '12:30:00' } })).id;
    });

    it('shows jobs in the agent zone at any distance, and nearby jobs within their radius', async () => {
      const seen = (await available(agent.userId)).items.map((item) => item.id);
      for (const key of ['inZoneFar', 'near2km', 'hourlyUnskilled', 'afterBuffer', 'inHours']) {
        assert.ok(seen.includes(ids[key]), `expected ${key}`);
      }
    });

    it('hides jobs outside the radius, without a pin, unskilled, past, clashing, on a day off or outside hours', async () => {
      const seen = (await available(agent.userId)).items.map((item) => item.id);
      for (const key of ['far4km', 'noPin', 'unskilled', 'past', 'clash', 'inBuffer', 'dayOff', 'outOfHours']) {
        assert.ok(!seen.includes(ids[key]), `did not expect ${key}`);
      }
    });

    it('reports a real total and pages after filtering', async () => {
      const all = await available(agent.userId);
      const page2 = await available(agent.userId, { page: 2, limit: 2 });
      assert.equal(all.meta.total, all.items.length);
      assert.equal(page2.meta.total, all.items.length);
      assert.deepEqual(page2.items.map((item) => item.id), all.items.slice(2, 4).map((item) => item.id));
    });

    it('gives distance, but only rounded coordinates and no street until the job is accepted', async () => {
      const near = (await available(agent.userId)).items.find((item) => item.id === ids.near2km)!;
      assert.ok(Math.abs((near.distanceKm ?? 0) - 2) < 0.01);
      assert.equal(near.address.latitude, Number(north(base, 2).lat.toFixed(2)));
      assert.equal(near.address.addressLine1, undefined);
    });

    it('a boosted agent (5 km radius) also sees the 4 km job', async () => {
      const boosted = await f.agent('booster', { live: base, skills: [skill], boost: true });
      const seen = (await available(boosted.userId)).items.map((item) => item.id);
      assert.ok(seen.includes(ids.far4km));
    });

    it('lists an offered job first with its expiry, even from outside the radius', async () => {
      const offered = await job(north(area(1.5), 0));
      await f.agent('offer-target', { live: north(area(1.5), 7.5), skills: [skill] });
      await dispatch.kick(offered.id);
      // Nobody within 3/5 km: the 7.5 km agent gets it in wave 3.
      const target = await h.repo(E.Agent).findOneByOrFail({ firstName: 'offer-target' });
      const list = await available(target.userId);
      assert.equal(list.items[0]?.id, offered.id);
      assert.ok(list.items[0]?.offerExpiresAt);
    });
  });

  describe('accepting', () => {
    it('two agents racing for one job: exactly one wins, the other gets 409', async () => {
      const base = area(2);
      const a = await f.agent('race-a', { live: base, skills: [skill] });
      const b = await f.agent('race-b', { live: base, skills: [skill] });
      const booking = await job(base);
      const results = await Promise.allSettled([jobs.accept(a.userId, booking.id), jobs.accept(b.userId, booking.id)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      assert.equal(loser.reason.status, 409);
    });

    it('one agent accepting two overlapping jobs at once never ends up holding both', async () => {
      const base = area(3);
      const a = await f.agent('double', { live: base, skills: [skill] });
      const one = await job(base);
      const two = await job(base);
      await Promise.allSettled([jobs.accept(a.userId, one.id), jobs.accept(a.userId, two.id)]);
      const held = [await reload(h, one.id), await reload(h, two.id)].filter((b) => b.agentId === a.id);
      assert.ok(held.length <= 1);
    });

    it('refuses a job that clashes with one already held', async () => {
      const base = area(4);
      const a = await f.agent('clasher', { live: base, skills: [skill] });
      await job(base, { status: 'accepted', agentId: a.id });
      const second = await job(base, { when: { date: dayOffset(1), time: '10:45:00' } });
      await rejectsWith(jobs.accept(a.userId, second.id), 409);
    });

    it('refuses a job past its start', async () => {
      const base = area(5);
      const a = await f.agent('late', { live: base, skills: [skill] });
      const old = await job(base, { when: at(-120) });
      await rejectsWith(jobs.accept(a.userId, old.id), 409);
    });

    it('an unapproved agent cannot accept', async () => {
      const base = area(6);
      const a = await f.agent('pending', { live: base, skills: [skill], approvalStatus: 'PENDING' });
      await rejectsWith(jobs.accept(a.userId, (await job(base)).id), 403);
    });
  });

  describe('doing the job', () => {
    it('accept → arrived → start with the OTP → complete records the earning', async () => {
      const base = area(7);
      const a = await f.agent('worker', { live: base, skills: [skill] });
      const booking = await job(base, { when: at(3 * 60) });

      await jobs.accept(a.userId, booking.id);
      assert.equal((await reload(h, booking.id)).status, 'accepted');
      const detail = (await jobs.detail(a.userId, booking.id)) as { address: { addressLine1?: string } };
      assert.ok(detail.address.addressLine1, 'full address once accepted');

      await jobs.arrived(a.userId, booking.id);
      assert.equal((await reload(h, booking.id)).status, 'arriving');

      await rejectsWith(jobs.start(a.userId, booking.id, { otp: '0000' } as never), 400);
      await jobs.start(a.userId, booking.id, { otp: '4321' } as never);
      assert.equal((await reload(h, booking.id)).status, 'ongoing');

      const done = (await jobs.complete(a.userId, booking.id, { notes: 'all good' } as never)) as {
        earning: { earningAmount: number };
      };
      const after = await reload(h, booking.id);
      assert.equal(after.status, 'completed');
      assert.ok(after.endTime);
      assert.equal(done.earning.earningAmount, 180); // 60% of 300 with no per-hour payout set
      const notes = await h.repo(E.Notification).find({ where: { userId: customerUser.id } });
      const types = new Set(notes.map((n) => n.notificationType));
      for (const type of ['booking_accepted', 'booking_arriving', 'booking_started', 'booking_completed']) {
        assert.ok(types.has(type), `customer told: ${type}`);
      }
    });

    it('cannot start a job before accepting it', async () => {
      const base = area(8);
      const a = await f.agent('eager', { live: base, skills: [skill] });
      const booking = await job(base);
      await assert.rejects(jobs.start(a.userId, booking.id, { otp: '4321' } as never));
    });

    it('a plan moves visit by visit: each completion goes back to accepted with the next OTP, the last completes it', async () => {
      const base = area(9);
      const a = await f.agent('cook', { live: base, skills: [skill] });
      const plan = await job(base, { planType: 'MONTHLY', when: { date: dayOffset(0), time: '08:00:00' } });
      await h.repo(E.BookingVisit).save(
        [0, 1].map((offset, index) => ({
          bookingId: plan.id,
          visitDate: dayOffset(offset),
          shift: 'morning',
          startTime: '08:00:00',
          otp: index === 0 ? '4321' : '8765',
          status: 'pending',
        })) as never,
      );
      await h.repo(E.Booking).update({ id: plan.id }, { status: 'accepted', agentId: a.id });

      await jobs.start(a.userId, plan.id, { otp: '4321' } as never);
      await jobs.complete(a.userId, plan.id, {} as never);
      let after = await reload(h, plan.id);
      assert.equal(after.status, 'accepted');
      assert.equal(after.startOtp, '8765');

      await jobs.start(a.userId, plan.id, { otp: '8765' } as never);
      await jobs.complete(a.userId, plan.id, {} as never);
      after = await reload(h, plan.id);
      assert.equal(after.status, 'completed');
    });
  });

  describe('giving a job back', () => {
    it('declining an offered (not held) job just excludes the agent', async () => {
      const base = area(10);
      const a = await f.agent('decliner', { live: base, skills: [skill] });
      const booking = await job(base);
      await jobs.reject(a.userId, booking.id, {} as never);
      assert.ok((await offersOf(h, f, booking.id)).includes('decliner:0:declined'));
    });

    it('releasing a held job a day ahead puts it back in dispatch and tells the customer', async () => {
      const base = area(11);
      const a = await f.agent('releaser', { live: base, skills: [skill] });
      await f.agent('backup', { live: north(base, 1), skills: [skill] });
      const booking = await job(base, { status: 'accepted', agentId: a.id, when: at(26 * 60) });
      await jobs.reject(a.userId, booking.id, {} as never);
      const after = await reload(h, booking.id);
      assert.equal(after.status, 'paid');
      assert.equal(after.agentId, null);
      const offers = await offersOf(h, f, booking.id);
      assert.ok(offers.includes('releaser:0:released') && offers.includes('backup:1:pending'), offers.join());
    });

    it('cannot release within 2 hours of the start, or once on the way', async () => {
      const base = area(12);
      const a = await f.agent('stuck', { live: base, skills: [skill] });
      const soon = await job(base, { status: 'accepted', agentId: a.id, when: at(60) });
      await rejectsWith(jobs.reject(a.userId, soon.id, {} as never), 400);
      const onTheWay = await job(base, { status: 'arriving', agentId: a.id, when: at(26 * 60) });
      await rejectsWith(jobs.reject(a.userId, onTheWay.id, {} as never), 400);
    });

    it('allows 3 releases in 30 days, then sends the agent to support', async () => {
      const a = await f.agent('serial', { live: area(13), skills: [skill] });
      const held: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        held.push((await job(north(area(13), i * 0.2), { status: 'accepted', agentId: a.id, when: at((30 + i * 3) * 60) })).id);
      }
      for (let i = 0; i < 3; i += 1) await jobs.reject(a.userId, held[i], {} as never);
      await rejectsWith(jobs.reject(a.userId, held[3], {} as never), 400);
    });
  });

  describe('when things go wrong', () => {
    it('an agent with no "arrived" 20 minutes after the start is a no-show: released and re-dispatched', async () => {
      const base = area(14);
      const a = await f.agent('no-show', { live: base, skills: [skill] });
      await f.agent('stand-in', { live: north(base, 1), skills: [skill] });
      const missed = await job(base, { status: 'accepted', agentId: a.id, when: at(-25) });
      const justStarted = await job(north(base, 0.1), { status: 'accepted', agentId: a.id, when: at(-5) });
      await dispatch.tick();
      const after = await reload(h, missed.id);
      assert.equal(after.agentId, null);
      const offers = await offersOf(h, f, missed.id);
      assert.ok(offers.includes('no-show:0:released') && offers.includes('stand-in:1:pending'), offers.join());
      assert.equal((await reload(h, justStarted.id)).agentId, a.id, 'only 5 minutes late: left alone');
    });

    it("a suspended agent's held jobs are released", async () => {
      const base = area(15);
      const a = await f.agent('suspended', { live: base, skills: [skill] });
      const held = await job(base, { status: 'accepted', agentId: a.id });
      await h.repo(E.Agent).update({ id: a.id }, { status: 'SUSPENDED' });
      await dispatch.tick();
      assert.equal((await reload(h, held.id)).agentId, null);
    });

    it('an agent cannot go offline, or narrow their hours, on a day they hold a job', async () => {
      const base = area(16);
      const a = await f.agent('offline', { live: base, skills: [skill] });
      const date = dayOffset(2);
      await job(base, { status: 'accepted', agentId: a.id, when: { date, time: '10:00:00' } });
      await rejectsWith(availability.update(a.userId, { availabilityDate: date, isAvailable: false } as never), 400);
      await rejectsWith(availability.update(a.userId, { availabilityDate: date, isAvailable: true, startTime: '12:00', endTime: '18:00' } as never), 400);
      await availability.update(a.userId, { availabilityDate: date, isAvailable: true, startTime: '09:00', endTime: '18:00' } as never);
      await availability.update(a.userId, { availabilityDate: dayOffset(5), isAvailable: false } as never);
    });

    it('a customer reschedule that clashes with the agent releases them; one that fits keeps them', async () => {
      const base = area(17);
      const a = await f.agent('rescheduled', { live: base, skills: [skill] });
      const date = dayOffset(2);
      await job(base, { status: 'accepted', agentId: a.id, when: { date, time: '15:00:00' } });
      const booking = await job(base, { status: 'accepted', agentId: a.id, when: { date, time: '10:00:00' } });

      const fits = (await customerBookings.reschedule(customerUser.id, booking.id, { bookingDate: date, startTime: '11:00' } as never)) as { agentReleased: boolean };
      assert.equal(fits.agentReleased, false);
      assert.equal((await reload(h, booking.id)).agentId, a.id);

      const clashes = (await customerBookings.reschedule(customerUser.id, booking.id, { bookingDate: date, startTime: '15:30' } as never)) as { agentReleased: boolean };
      assert.equal(clashes.agentReleased, true);
      assert.equal((await reload(h, booking.id)).agentId, null);
    });

    it('a customer cancelling an accepted job refunds it and tells the agent', async () => {
      const base = area(18);
      const a = await f.agent('cancelled-on', { live: base, skills: [skill] });
      const booking = await job(base, { status: 'accepted', agentId: a.id });
      const result = (await customerBookings.cancel(customerUser.id, booking.id, { reason: 'plans changed' } as never)) as { paymentStatus: string };
      assert.equal((await reload(h, booking.id)).status, 'cancelled');
      assert.equal(result.paymentStatus, 'VOIDED'); // no payment row on this test booking → voided
      assert.ok(await h.repo(E.Notification).findOneBy({ userId: a.userId, title: 'Booking cancelled' }));
    });

    it('a job already in progress cannot be cancelled', async () => {
      const base = area(19);
      const a = await f.agent('busy', { live: base, skills: [skill] });
      const booking = await job(base, { status: 'ongoing', agentId: a.id });
      await rejectsWith(customerBookings.cancel(customerUser.id, booking.id, {} as never), 400);
    });
  });
});
