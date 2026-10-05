import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Factory,
  Harness,
  area,
  asSuperAdmin,
  at,
  dayOffset,
  dispatchState,
  lapseOffers,
  north,
  offersOf,
  reload,
  rejectsWith,
  startApp,
} from './support/harness';
import * as E from 'src/database/entities';
import { DispatchService } from 'src/dispatch/dispatch.service';
import { AgentBookingsService } from 'src/agent/bookings/bookings.service';
import { AdminBookingsService } from 'src/admin/bookings/bookings.service';
import { CustomerBookingsService } from 'src/customer/bookings/bookings.service';

describe('Push dispatch', () => {
  let h: Harness;
  let f: Factory;
  let dispatch: DispatchService;
  let agentBookings: AgentBookingsService;
  let admin: AdminBookingsService;
  let customerBookings: CustomerBookingsService;
  let cleaning: E.Service;
  let cooking: E.Service;
  let skill: E.Skill;
  let customer: E.Customer;
  let customerUser: E.User;
  let adminId: string;

  before(async () => {
    h = await startApp();
    f = new Factory(h);
    dispatch = h.get(DispatchService);
    agentBookings = h.get(AgentBookingsService);
    admin = h.get(AdminBookingsService);
    customerBookings = h.get(CustomerBookingsService);
    cleaning = await f.service('Home Cleaning');
    cooking = await f.service('Cooking');
    skill = await f.skill('Cleaning', 'cleaning');
    ({ user: customerUser, customer } = await f.customer());
    adminId = (await f.admin()).id;
  });
  after(() => h.close());

  const tomorrow = () => ({ date: dayOffset(1), time: '10:00:00' });
  const job = (base: { lat: number; lng: number }, extra: Partial<Parameters<Factory['booking']>[0]> = {}) =>
    f.booking({ customerId: customer.id, service: cleaning, point: base, when: tomorrow(), ...extra });

  describe('waves', () => {
    const base = area(1);
    let booking: E.Booking;

    before(async () => {
      const zone = await f.zone();
      await f.agent('w1', { live: north(base, 1), skills: [skill] });
      await f.agent('w2', { live: north(base, 2), skills: [skill] });
      await f.agent('w3', { live: north(base, 2.5), skills: [skill] });
      await f.agent('w4', { live: north(base, 4), skills: [skill] });
      await f.agent('w5-zone', { skills: [skill], zones: [zone.id] });
      await f.agent('w6', { live: north(base, 7), skills: [skill] });
      await f.agent('x-unskilled', { live: north(base, 0.5) });
      await f.agent('x-stale', { live: north(base, 0.3), staleFix: true, skills: [skill] });
      await f.agent('x-suspended', { live: north(base, 0.2), skills: [skill], status: 'SUSPENDED' });
      await f.agent('x-unapproved', { live: north(base, 0.2), skills: [skill], approvalStatus: 'PENDING' });
      const off = await f.agent('x-off', { live: north(base, 1.5), skills: [skill] });
      await f.unavailable(off.id, tomorrow().date);
      const busy = await f.agent('x-busy', { live: north(base, 1.2), skills: [skill] });
      await job(area(1.2), { status: 'accepted', agentId: busy.id, when: { date: tomorrow().date, time: '10:30:00' } });
      booking = await job(base, { zoneId: zone.id });
      await dispatch.kick(booking.id);
    });

    it('wave 1 offers the 3 nearest eligible agents within 3 km', async () => {
      assert.deepEqual(await offersOf(h, f, booking.id), ['w1:1:pending', 'w2:1:pending', 'w3:1:pending']);
    });

    it('pushes a job_offer notification to each of them', async () => {
      const count = await h.repo(E.Notification).count({ where: { notificationType: 'job_offer' } });
      assert.equal(count, 3);
    });

    it('a decline while others are still deciding does not start the next wave', async () => {
      const w1 = await h.repo(E.Agent).findOneByOrFail({ firstName: 'w1' });
      await agentBookings.reject(w1.userId, booking.id, {} as never);
      // The offer keeps the wave it was made in; only its status changes.
      assert.deepEqual(await offersOf(h, f, booking.id), ['w1:1:declined', 'w2:1:pending', 'w3:1:pending']);
    });

    it('when wave 1 lapses, wave 2 reaches 5 km and the zone agent; ineligible agents are never asked', async () => {
      await lapseOffers(h, booking.id);
      await dispatch.tick();
      const offers = await offersOf(h, f, booking.id);
      assert.ok(offers.includes('w2:1:expired') && offers.includes('w3:1:expired'));
      assert.ok(offers.includes('w4:2:pending') && offers.includes('w5-zone:2:pending'));
      assert.ok(!offers.some((offer) => offer.startsWith('x-')), offers.join());
    });

    it('the first accept wins: offer accepted, the rest withdrawn, dispatch assigned', async () => {
      const w4 = await h.repo(E.Agent).findOneByOrFail({ firstName: 'w4' });
      await agentBookings.accept(w4.userId, booking.id);
      const offers = await offersOf(h, f, booking.id);
      assert.ok(offers.includes('w4:2:accepted') && offers.includes('w5-zone:2:cancelled'));
      assert.equal((await dispatchState(h, booking.id))?.status, 'assigned');
      assert.equal((await reload(h, booking.id)).status, 'accepted');
    });

    it('a second accept gets 409', async () => {
      const w5 = await h.repo(E.Agent).findOneByOrFail({ firstName: 'w5-zone' });
      await rejectsWith(agentBookings.accept(w5.userId, booking.id), 409);
    });

    it('a released job goes straight to the next wave, never back to the agent who released it', async () => {
      const w4 = await h.repo(E.Agent).findOneByOrFail({ firstName: 'w4' });
      await agentBookings.reject(w4.userId, booking.id, { reason: 'sick' } as never);
      const offers = await offersOf(h, f, booking.id);
      assert.ok(offers.includes('w4:2:released'), offers.join());
      assert.ok(offers.includes('w6:3:pending'), offers.join());
    });

    it('with nobody left it is exhausted, stays open, and retries in ~10 minutes', async () => {
      await lapseOffers(h, booking.id);
      await dispatch.tick();
      const state = await dispatchState(h, booking.id);
      assert.equal(state?.status, 'exhausted');
      const minutes = (state!.nextActionAt!.getTime() - Date.now()) / 60_000;
      assert.ok(minutes > 9 && minutes <= 10, `${minutes}`);
      const after = await reload(h, booking.id);
      assert.equal(after.status, 'paid');
      assert.equal(after.agentId, null);
    });

    it('the exhausted retry gives agents who let an offer lapse one more chance (wave 4), never a third', async () => {
      await lapseOffers(h, booking.id);
      await dispatch.tick();
      const offers = await offersOf(h, f, booking.id);
      assert.ok(offers.some((offer) => /^(w2|w3|w5-zone|w6):4:pending$/.test(offer)), offers.join());
      await lapseOffers(h, booking.id);
      await dispatch.tick();
      await lapseOffers(h, booking.id);
      await dispatch.tick();
      const later = await offersOf(h, f, booking.id);
      assert.ok(!later.some((offer) => offer.includes(':4:pending')), later.join());
    });
  });

  describe('jobs closed elsewhere', () => {
    it('an admin assignment withdraws pending offers immediately', async () => {
      const base = area(2);
      const a = await f.agent('a1', { live: north(base, 1), skills: [skill] });
      await f.agent('a2', { live: north(base, 1.5), skills: [skill] });
      const booking = await job(base);
      await dispatch.kick(booking.id);
      await asSuperAdmin(() => admin.assignAgent(adminId, booking.id, { agentId: a.id } as never));
      const offers = await offersOf(h, f, booking.id);
      assert.ok(offers.includes('a1:1:accepted') && offers.includes('a2:1:cancelled'), offers.join());
    });

    it('a customer cancellation withdraws offers and closes dispatch on the next tick', async () => {
      const base = area(3);
      await f.agent('c1', { live: north(base, 1), skills: [skill] });
      const booking = await job(base);
      await dispatch.kick(booking.id);
      await customerBookings.cancel(customerUser.id, booking.id, {} as never);
      await dispatch.tick();
      assert.deepEqual(await offersOf(h, f, booking.id), ['c1:1:cancelled']);
      assert.equal((await dispatchState(h, booking.id))?.status, 'closed');
    });

    it('a job more than an hour past its start is closed without offers', async () => {
      const base = area(4);
      await f.agent('p1', { live: north(base, 1), skills: [skill] });
      const booking = await job(base, { when: at(-90) });
      await dispatch.kick(booking.id);
      assert.deepEqual(await offersOf(h, f, booking.id), []);
      assert.equal((await dispatchState(h, booking.id))?.status, 'closed');
    });

    it('rescheduling an open job withdraws its offers and starts over from wave 1', async () => {
      const base = area(5);
      await f.agent('r1', { live: north(base, 1), skills: [skill] });
      const booking = await job(base);
      await dispatch.kick(booking.id);
      await lapseOffers(h, booking.id);
      await dispatch.tick();
      await customerBookings.reschedule(customerUser.id, booking.id, {
        bookingDate: dayOffset(2),
        startTime: '12:00',
      } as never);
      assert.deepEqual(await offersOf(h, f, booking.id), ['r1:1:pending']);
    });
  });

  describe('who qualifies', () => {
    it('a job starting in 30 minutes only goes to agents with a live fix close enough to make it', async () => {
      const base = area(6);
      await f.agent('n-close', { live: north(base, 2), skills: [skill] });
      await f.agent('n-zone-far', { live: north(base, 12), skills: [skill], zones: [] });
      await f.agent('n-home-only', { live: north(base, 0.5), staleFix: true, home: north(base, 1), skills: [skill] });
      const booking = await job(base, { when: at(30) });
      await dispatch.kick(booking.id);
      assert.deepEqual(await offersOf(h, f, booking.id), ['n-close:1:pending']);
    });

    it("an agent with a stale fix is matched from their home address for tomorrow's job", async () => {
      const base = area(7);
      await f.agent('h-home', { live: north(base, 30), staleFix: true, home: north(base, 1), skills: [skill] });
      const booking = await job(base);
      await dispatch.kick(booking.id);
      assert.deepEqual(await offersOf(h, f, booking.id), ['h-home:1:pending']);
    });

    it('On Demand (HOURLY) jobs skip the skill check', async () => {
      const base = area(8);
      await f.agent('any-agent', { live: north(base, 1) });
      const booking = await f.booking({
        customerId: customer.id,
        service: cooking,
        point: base,
        when: tomorrow(),
        planType: 'HOURLY',
      });
      await dispatch.kick(booking.id);
      assert.deepEqual(await offersOf(h, f, booking.id), ['any-agent:1:pending']);
    });

    it('a job that matches nobody is exhausted straight away', async () => {
      const booking = await job(area(9));
      await dispatch.kick(booking.id);
      assert.equal((await dispatchState(h, booking.id))?.status, 'exhausted');
    });
  });

  describe('concurrency', () => {
    it('a kick racing a tick (and another kick) sends one wave and one set of pushes', async () => {
      const base = area(10);
      for (const name of ['k1', 'k2', 'k3', 'k4']) {
        await f.agent(name, { live: north(base, 1), skills: [skill] });
      }
      const before = await h.repo(E.Notification).count({ where: { notificationType: 'job_offer' } });
      const booking = await job(base);
      await Promise.all([dispatch.kick(booking.id), dispatch.kick(booking.id), dispatch.tick()]);
      const offers = await offersOf(h, f, booking.id);
      assert.equal(offers.length, 3, offers.join());
      const pushes = (await h.repo(E.Notification).count({ where: { notificationType: 'job_offer' } })) - before;
      assert.equal(pushes, 3);
    });
  });
});
