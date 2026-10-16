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
import { In } from 'typeorm';
import { WalletService } from 'src/common/services/wallet.service';
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

  describe('broadcast', () => {
    const base = area(1);
    let booking: E.Booking;
    const eligible = ['b1', 'b2', 'b3', 'b4', 'b5', 'b-zone'];

    before(async () => {
      const zone = await f.zone();
      await f.agent('b1', { live: north(base, 0.3), skills: [skill] });
      await f.agent('b2', { live: north(base, 0.9), skills: [skill] });
      await f.agent('b3', { live: north(base, 1.5), skills: [skill] });
      await f.agent('b4', { live: north(base, 2.5), skills: [skill] });
      await f.agent('b5', { live: north(base, 3.5), skills: [skill] });
      await f.agent('b-zone', { skills: [skill], zones: [zone.id] });
      await f.agent('b-far', { live: north(base, 6), skills: [skill] });
      await f.agent('x-unskilled', { live: north(base, 0.5) });
      await f.agent('x-stale', { live: north(base, 0.3), staleFix: true, skills: [skill] });
      await f.agent('x-suspended', { live: north(base, 0.2), skills: [skill], status: 'SUSPENDED' });
      await f.agent('x-unapproved', { live: north(base, 0.2), skills: [skill], approvalStatus: 'PENDING' });
      const off = await f.agent('x-off', { live: north(base, 0.4), skills: [skill] });
      await f.unavailable(off.id, tomorrow().date);
      const busy = await f.agent('x-busy', { live: north(base, 0.7), skills: [skill] });
      await job(area(1.2), { status: 'accepted', agentId: busy.id, when: { date: tomorrow().date, time: '10:30:00' } });
      booking = await job(base, { zoneId: zone.id });
      await dispatch.kick(booking.id);
    });

    it('offers the job to every eligible agent within 4 km, and in its zone, at once', async () => {
      const offers = await offersOf(h, f, booking.id);
      assert.deepEqual([...offers].sort(), eligible.map((name) => `${name}:1:pending`).sort());
      assert.ok(!offers.some((offer) => offer.startsWith('x-') || offer.startsWith('b-far')), offers.join());
    });

    it('pushes a job_offer notification to each of them', async () => {
      const count = await h.repo(E.Notification).count({ where: { notificationType: 'job_offer' } });
      assert.equal(count, eligible.length);
    });

    it('a decline changes nothing for the others', async () => {
      const b1 = await h.repo(E.Agent).findOneByOrFail({ firstName: 'b1' });
      await agentBookings.reject(b1.userId, booking.id, {} as never);
      const offers = await offersOf(h, f, booking.id);
      assert.ok(offers.includes('b1:1:declined'));
      assert.equal(offers.filter((offer) => offer.endsWith(':1:pending')).length, eligible.length - 1);
    });

    it('the first accept wins: offer accepted, the rest withdrawn, dispatch assigned', async () => {
      const b3 = await h.repo(E.Agent).findOneByOrFail({ firstName: 'b3' });
      await agentBookings.accept(b3.userId, booking.id);
      const offers = await offersOf(h, f, booking.id);
      assert.ok(offers.includes('b3:1:accepted') && offers.includes('b2:1:cancelled'), offers.join());
      assert.ok(!offers.some((offer) => offer.endsWith(':pending')), offers.join());
      assert.equal((await dispatchState(h, booking.id))?.status, 'assigned');
      assert.equal((await reload(h, booking.id)).status, 'accepted');
    });

    it('a second accept gets 409', async () => {
      const b2 = await h.repo(E.Agent).findOneByOrFail({ firstName: 'b2' });
      await rejectsWith(agentBookings.accept(b2.userId, booking.id), 409);
    });

    it('a released job is broadcast again at once, to all but the agent who released it and decliners', async () => {
      const b3 = await h.repo(E.Agent).findOneByOrFail({ firstName: 'b3' });
      await agentBookings.reject(b3.userId, booking.id, { reason: 'sick' } as never);
      const offers = await offersOf(h, f, booking.id);
      assert.ok(offers.includes('b3:1:released') && offers.includes('b1:1:declined'), offers.join());
      for (const name of ['b2', 'b4', 'b5', 'b-zone']) {
        assert.ok(offers.includes(`${name}:1:pending`), `${name} re-asked: ${offers.join()}`);
      }
      assert.ok(!offers.some((offer) => offer.startsWith('b-far')), offers.join());
    });
  });

  describe('when nobody accepts', () => {
    it('it stays open, is broadcast once more after ~10 minutes, and never a third time', async () => {
      const base = area(27);
      await f.agent('l1', { live: north(base, 0.5), skills: [skill] });
      await f.agent('l2', { live: north(base, 1.5), skills: [skill] });
      const booking = await job(base);
      await dispatch.kick(booking.id);
      assert.deepEqual([...(await offersOf(h, f, booking.id))].sort(), ['l1:1:pending', 'l2:1:pending']);

      await lapseOffers(h, booking.id);
      await dispatch.tick();
      const state = await dispatchState(h, booking.id);
      assert.equal(state?.status, 'exhausted');
      const minutes = (state!.nextActionAt!.getTime() - Date.now()) / 60_000;
      assert.ok(minutes > 9 && minutes <= 10, `${minutes}`);
      assert.equal((await reload(h, booking.id)).status, 'paid');

      await lapseOffers(h, booking.id);
      await dispatch.tick();
      assert.deepEqual([...(await offersOf(h, f, booking.id))].sort(), ['l1:2:pending', 'l2:2:pending']);

      await lapseOffers(h, booking.id);
      await dispatch.tick();
      await lapseOffers(h, booking.id);
      await dispatch.tick();
      const later = await offersOf(h, f, booking.id);
      assert.ok(!later.some((offer) => offer.endsWith(':pending')), later.join());
    });
  });

  describe('jobs closed elsewhere', () => {
    it('an admin assignment withdraws pending offers immediately', async () => {
      const base = area(2);
      const a = await f.agent('a1', { live: north(base, 0.4), skills: [skill] });
      await f.agent('a2', { live: north(base, 0.7), skills: [skill] });
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

    it('a job past its start is closed without offers', async () => {
      const base = area(4);
      await f.agent('p1', { live: north(base, 1), skills: [skill] });
      const booking = await job(base, { when: at(-5) });
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
      await f.agent('n-close', { live: north(base, 0.8), skills: [skill] });
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

  describe('"Right now" jobs', () => {
    const instantJob = async (base: { lat: number; lng: number }) => {
      const booking = await job(base, { when: at(15) });
      await h.repo(E.Booking).update({ id: booking.id }, { bookingMode: 'INSTANT' });
      await h.repo(E.Payment).save({
        bookingId: booking.id,
        customerId: customer.id,
        amount: '300.00',
        paymentStatus: 'PAID',
      } as Partial<E.Payment>);
      return booking;
    };
    /** Pretends dispatch started `minutes` ago and makes it due now. */
    const searchedFor = (bookingId: string, minutes: number) =>
      h.ds.query(
        `UPDATE booking_dispatches SET created_at = now() - make_interval(mins => $2), next_action_at = now() WHERE booking_id = $1`,
        [bookingId, minutes],
      );

    it('expires when nobody accepts within 10 minutes, refunds to the wallet, and tells the customer', async () => {
      const base = area(20);
      await f.agent('n1', { live: north(base, 1), skills: [skill] });
      const booking = await instantJob(base);
      await dispatch.kick(booking.id);
      assert.deepEqual(await offersOf(h, f, booking.id), ['n1:1:pending']);

      const noticesBefore = await h.repo(E.Notification).count({
        where: { userId: customerUser.id, notificationType: 'booking_expired' },
      });
      await searchedFor(booking.id, 11);
      await dispatch.tick();

      const after = await reload(h, booking.id);
      assert.equal(after.status, 'expired');
      assert.equal(after.agentId, null);
      assert.equal(after.paymentStatus, 'REFUNDED');
      const payment = await h.repo(E.Payment).findOneByOrFail({ bookingId: booking.id });
      assert.equal(payment.paymentStatus, 'REFUNDED');
      const credit = await h.repo(E.WalletTransaction).findOneByOrFail({ bookingId: booking.id });
      assert.equal(credit.reason, 'BOOKING_EXPIRED');
      assert.equal(Number(credit.amount), 300);
      assert.deepEqual(await offersOf(h, f, booking.id), ['n1:1:cancelled']);
      assert.equal((await dispatchState(h, booking.id))?.status, 'closed');
      const noticesAfter = await h.repo(E.Notification).count({
        where: { userId: customerUser.id, notificationType: 'booking_expired' },
      });
      assert.equal(noticesAfter - noticesBefore, 1);
      const n1 = await h.repo(E.Agent).findOneByOrFail({ firstName: 'n1' });
      await rejectsWith(agentBookings.accept(n1.userId, booking.id), 409);
    });

    it('when every wave runs dry, looks again when its 10 minutes are up, not in 10 more', async () => {
      const booking = await instantJob(area(21));
      await dispatch.kick(booking.id);
      await searchedFor(booking.id, 8);
      await dispatch.tick();
      const state = await dispatchState(h, booking.id);
      assert.equal(state?.status, 'exhausted');
      const minutes = (state!.nextActionAt!.getTime() - Date.now()) / 60_000;
      assert.ok(minutes > 1 && minutes <= 2, `${minutes}`);
    });

    it('a job taken back from its agent gets a fresh 10 minutes, and the customer hears it once', async () => {
      const base = area(23);
      const a = await f.agent('r-held', { live: north(base, 1), skills: [skill] });
      const booking = await instantJob(base);
      await dispatch.kick(booking.id);
      await agentBookings.accept(a.userId, booking.id);
      await searchedFor(booking.id, 11);

      assert.equal(await dispatch.release(booking.id, 'the agent account is no longer active'), true);
      const after = await reload(h, booking.id);
      assert.equal(after.status, 'paid');
      assert.equal(after.agentId, null);
      const notices = await h.repo(E.Notification).find({
        where: { userId: customerUser.id, notificationType: In(['booking_released', 'booking_expired']) },
      });
      assert.ok(notices.some((n) => n.title === 'Finding you a new expert'));
    });

    it('a cancel racing the expiry settles once: one status, one wallet credit', async () => {
      const booking = await instantJob(area(24));
      await dispatch.kick(booking.id);
      await searchedFor(booking.id, 11);
      await Promise.allSettled([
        dispatch.tick(),
        customerBookings.cancel(customerUser.id, booking.id, {} as never),
      ]);
      const after = await reload(h, booking.id);
      assert.ok(['expired', 'cancelled'].includes(after.status), after.status);
      assert.equal(after.paymentStatus, 'REFUNDED');
      assert.equal(await h.repo(E.WalletTransaction).countBy({ bookingId: booking.id }), 1);
      const history = await h.repo(E.BookingStatusHistory).findBy({ bookingId: booking.id });
      assert.equal(history.filter((row) => ['expired', 'cancelled'].includes(row.status)).length, 1);
    });

    it('if the wallet credit fails, nothing about the booking or payment changes', async () => {
      const booking = await instantJob(area(25));
      const wallet = h.get(WalletService);
      const original = wallet.refundBooking;
      wallet.refundBooking = async () => {
        throw new Error('wallet down');
      };
      try {
        await assert.rejects(customerBookings.cancel(customerUser.id, booking.id, {} as never));
      } finally {
        wallet.refundBooking = original;
      }
      const after = await reload(h, booking.id);
      assert.equal(after.status, 'paid');
      assert.equal(after.paymentStatus, 'PAID');
      assert.equal((await h.repo(E.Payment).findOneByOrFail({ bookingId: booking.id })).paymentStatus, 'PAID');
    });

    it('without a timer, the customer polling their bookings is enough to expire it (once per window)', async () => {
      const booking = await instantJob(area(26));
      await dispatch.kick(booking.id);
      await searchedFor(booking.id, 11);
      await h.ds.query(`UPDATE dispatch_clock SET next_tick_at = now() WHERE id = 1`);
      process.env.DISPATCH_REQUEST_TICK_SECONDS = '20';
      try {
        const listed = await customerBookings.list(customerUser.id, {} as never);
        assert.equal(listed.items.find((item) => item.id === booking.id)?.status, 'expired');
        const [clock] = await h.ds.query(`SELECT next_tick_at FROM dispatch_clock WHERE id = 1`);
        const seconds = (new Date(clock.next_tick_at).getTime() - Date.now()) / 1000;
        assert.ok(seconds > 15 && seconds <= 20, `${seconds}`);
      } finally {
        process.env.DISPATCH_REQUEST_TICK_SECONDS = '0';
      }
    });

    it('the open-jobs list tells the agent app when each job stops being open', async () => {
      const base = area(28);
      const a = await f.agent('e-list', { live: north(base, 0.5), skills: [skill] });
      const instant = await instantJob(base);
      await dispatch.kick(instant.id);
      const scheduled = await job(base);

      const items = (await agentBookings.list(a.userId, { scope: 'available', limit: 50 } as never)).items as Array<{
        id: string;
        expiresAt: string | null;
      }>;
      const [dispatchRow] = await h.ds.query(`SELECT created_at FROM booking_dispatches WHERE booking_id = $1`, [instant.id]);
      const searchEnd = new Date(dispatchRow.created_at).getTime() + 10 * 60_000;
      // "Right now": the 10-minute search ends before its start (~15 min away).
      const instantItem = items.find((item) => item.id === instant.id);
      assert.ok(instantItem?.expiresAt, 'instant job has an expiry');
      assert.ok(Math.abs(Date.parse(instantItem!.expiresAt!) - searchEnd) < 2000, instantItem!.expiresAt!);
      // Scheduled: open until its start.
      const scheduledItem = items.find((item) => item.id === scheduled.id);
      assert.equal(
        Date.parse(scheduledItem!.expiresAt!),
        new Date(`${scheduled.bookingDate}T${scheduled.startTime}`).getTime(),
      );
    });

    it('a scheduled job keeps searching past 10 minutes', async () => {
      const base = area(22);
      await f.agent('s1', { live: north(base, 1), skills: [skill] });
      const booking = await job(base);
      await dispatch.kick(booking.id);
      await searchedFor(booking.id, 30);
      await lapseOffers(h, booking.id);
      await dispatch.tick();
      assert.equal((await reload(h, booking.id)).status, 'paid');
    });
  });

  describe('concurrency', () => {
    it('a kick racing a tick (and another kick) sends one broadcast and one set of pushes', async () => {
      const base = area(10);
      for (const name of ['k1', 'k2', 'k3', 'k4']) {
        await f.agent(name, { live: north(base, 1), skills: [skill] });
      }
      const before = await h.repo(E.Notification).count({ where: { notificationType: 'job_offer' } });
      const booking = await job(base);
      await Promise.all([dispatch.kick(booking.id), dispatch.kick(booking.id), dispatch.tick()]);
      const offers = await offersOf(h, f, booking.id);
      assert.equal(offers.length, 4, offers.join());
      const pushes = (await h.repo(E.Notification).count({ where: { notificationType: 'job_offer' } })) - before;
      assert.equal(pushes, 4);
    });
  });
});
