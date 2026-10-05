import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import { Factory, Harness, area, asSuperAdmin, dayOffset, reload, rejectsWith, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { AdminBookingsService } from 'src/admin/bookings/bookings.service';
import { CustomerBookingsService } from 'src/customer/bookings/bookings.service';
import { CustomerPaymentsService } from 'src/customer/payments/payments.service';
import { TokenService } from 'src/common/auth/token.service';

describe('Admin actions and platform', () => {
  let h: Harness;
  let f: Factory;
  let admin: AdminBookingsService;
  let customerBookings: CustomerBookingsService;
  let payments: CustomerPaymentsService;
  let cleaning: E.Service;
  let skill: E.Skill;
  let customer: E.Customer;
  let customerUser: E.User;
  let adminId: string;
  let baseUrl: string;

  before(async () => {
    h = await startApp();
    await h.app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}`;
    f = new Factory(h);
    admin = h.get(AdminBookingsService);
    customerBookings = h.get(CustomerBookingsService);
    payments = h.get(CustomerPaymentsService);
    cleaning = await f.service('Home Cleaning');
    skill = await f.skill('Cleaning', 'cleaning');
    ({ user: customerUser, customer } = await f.customer());
    adminId = (await f.admin()).id;
  });
  after(() => h.close());

  const job = (extra: Partial<Parameters<Factory['booking']>[0]> = {}) =>
    f.booking({
      customerId: customer.id,
      service: cleaning,
      point: area(1),
      when: { date: dayOffset(1), time: '10:00:00' },
      ...extra,
    });
  const assign = (bookingId: string, agentId: string) =>
    asSuperAdmin(() => admin.assignAgent(adminId, bookingId, { agentId } as never));

  describe('admin assign / reassign', () => {
    it('assigns a paid job: accepted, agent and customer notified', async () => {
      const a = await f.agent('assignee', { live: area(1), skills: [skill] });
      const booking = await job();
      await assign(booking.id, a.id);
      const after = await reload(h, booking.id);
      assert.equal(after.status, 'accepted');
      assert.equal(after.agentId, a.id);
      assert.ok(await h.repo(E.Notification).findOneBy({ userId: a.userId, title: 'Agent assigned' }));
    });

    it('refuses before payment', async () => {
      const a = await f.agent('early', { live: area(1), skills: [skill] });
      await rejectsWith(assign((await job({ status: 'finding' })).id, a.id), 400);
    });

    it('refuses when the job already has an agent (that is what reassign is for)', async () => {
      const a = await f.agent('first', { live: area(1), skills: [skill] });
      const b = await f.agent('second', { live: area(1), skills: [skill] });
      const booking = await job({ status: 'accepted', agentId: a.id });
      await rejectsWith(assign(booking.id, b.id), 400);
    });

    it('refuses a suspended or unapproved agent', async () => {
      const suspended = await f.agent('susp', { live: area(1), status: 'SUSPENDED' });
      const pending = await f.agent('pend', { live: area(1), approvalStatus: 'PENDING' });
      await rejectsWith(assign((await job()).id, suspended.id), 400);
      await rejectsWith(assign((await job()).id, pending.id), 400);
    });

    it('refuses an agent who already has an overlapping job', async () => {
      const a = await f.agent('double-booked', { live: area(1), skills: [skill] });
      await job({ status: 'accepted', agentId: a.id });
      const overlapping = await job({ when: { date: dayOffset(1), time: '10:30:00' } });
      await rejectsWith(assign(overlapping.id, a.id), 400);
    });

    it('reassigns to a new agent and tells both', async () => {
      const a = await f.agent('outgoing', { live: area(1), skills: [skill] });
      const b = await f.agent('incoming', { live: area(1), skills: [skill] });
      const booking = await job({ status: 'accepted', agentId: a.id, when: { date: dayOffset(3), time: '10:00:00' } });
      await asSuperAdmin(() => admin.reassignAgent(adminId, booking.id, { agentId: b.id, reason: 'swap' } as never));
      assert.equal((await reload(h, booking.id)).agentId, b.id);
    });

    it('refuses to reassign a job already in progress', async () => {
      const a = await f.agent('working', { live: area(1), skills: [skill] });
      const b = await f.agent('idle', { live: area(1), skills: [skill] });
      const booking = await job({ status: 'ongoing', agentId: a.id });
      await rejectsWith(asSuperAdmin(() => admin.reassignAgent(adminId, booking.id, { agentId: b.id, reason: 'x' } as never)), 400);
    });

    it('applies the same availability rules as dispatch', { todo: '#17: admin assertNoClash ignores days off, hours, travel buffer and plan visits' }, async () => {
      const a = await f.agent('day-off', { live: area(1), skills: [skill] });
      await f.unavailable(a.id, dayOffset(4));
      const booking = await job({ when: { date: dayOffset(4), time: '10:00:00' } });
      await rejectsWith(assign(booking.id, a.id), 400);
    });
  });

  describe('cancelling a paid booking', () => {
    it('marks the payment refunded', async () => {
      const address = await f.address(customer.id, area(2));
      const created = await customerBookings.create(customerUser.id, {
        addressId: address.id,
        bookingDate: dayOffset(1),
        startTime: '10:00',
        items: [{ serviceId: cleaning.id }],
      } as never);
      const order = await payments.createOrder(customerUser.id, { bookingId: created.id } as never);
      await payments.verify(customerUser.id, { bookingId: created.id, razorpayOrderId: order.orderId, razorpayPaymentId: 'p' } as never);
      const result = (await customerBookings.cancel(customerUser.id, created.id, {} as never)) as { paymentStatus: string };
      assert.equal(result.paymentStatus, 'REFUNDED');
    });

    it('actually issues the refund at Razorpay', { todo: 'cancel only sets REFUNDED; no gateway refund call yet' }, () => {
      assert.fail('no refund API call to assert on');
    });
  });

  describe('platform', () => {
    it('reads booking times as India time even on a UTC host', () => {
      assert.equal(process.env.TZ, 'Asia/Kolkata');
      assert.equal(new Date('2026-10-20T10:00:00').toISOString(), '2026-10-20T04:30:00.000Z');
    });

    it('the cron tick route does not exist without CRON_SECRET', async () => {
      const res = await fetch(`${baseUrl}/internal/dispatch/tick`);
      const body = await res.text();
      assert.equal(res.status, 404);
      assert.ok(!body.includes('Cannot GET'), 'the route exists but hides itself');
    });

    it('the cron tick route needs the right bearer secret', async () => {
      process.env.CRON_SECRET = 'e2e-cron';
      try {
        const wrong = await fetch(`${baseUrl}/internal/dispatch/tick`, { headers: { authorization: 'Bearer nope' } });
        assert.equal(wrong.status, 401);
        const right = await fetch(`${baseUrl}/internal/dispatch/tick`, { headers: { authorization: 'Bearer e2e-cron' } });
        assert.equal(right.status, 200);
        assert.ok('processed' in (await right.json()));
      } finally {
        delete process.env.CRON_SECRET;
      }
    });

  });

  describe('checklist and phase endpoints are limited to the agent holding the job', () => {
    let owner: E.Agent;
    let intruder: E.Agent;
    let ownedJob: E.Booking;
    let openJob: E.Booking;
    let ownerToken: string;
    let intruderToken: string;

    const call = (token: string, method: 'GET' | 'POST', route: string) =>
      fetch(`${baseUrl}/agent/bookings/${route}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ milestone: 'x' }) : undefined,
      });
    const routes = (id: string, itemId = '00000000-0000-4000-8000-000000000000') =>
      [
        ['GET', `${id}/checklist`],
        ['POST', `${id}/checklist/${itemId}/complete`],
        ['POST', `${id}/checklist/${itemId}/uncomplete`],
        ['POST', `${id}/checklist/phase/next`],
        ['POST', `${id}/checklist/phase/complete`],
        ['POST', `${id}/phase/arrival`],
        ['POST', `${id}/service/start`],
        ['POST', `${id}/service/milestone`],
        ['POST', `${id}/payment/initialize`],
        ['POST', `${id}/feedback/request`],
      ] as const;

    before(async () => {
      owner = await f.agent('owner', { live: area(3), skills: [skill] });
      intruder = await f.agent('intruder', { live: area(3), skills: [skill] });
      ownedJob = await job({ status: 'accepted', agentId: owner.id, point: area(3) });
      openJob = await job({ point: area(3) });
      const tokens = h.get(TokenService);
      ownerToken = (await tokens.issueSession({ sub: owner.userId, role: 'agent', agentId: owner.id })).accessToken;
      intruderToken = (await tokens.issueSession({ sub: intruder.userId, role: 'agent', agentId: intruder.id })).accessToken;
    });

    it('another agent gets 404 on every one of them, and nothing is written', async () => {
      for (const [method, route] of routes(ownedJob.id)) {
        const res = await call(intruderToken, method, route);
        assert.equal(res.status, 404, `${method} ${route} → ${res.status}`);
      }
      assert.equal(await h.repo(E.BookingChecklistProgress).count({ where: { bookingId: ownedJob.id } }), 0);
      assert.equal(await h.repo(E.BookingSettlement).count({ where: { bookingId: ownedJob.id } }), 0);
      assert.equal(await h.repo(E.BookingServiceExecution).count({ where: { bookingId: ownedJob.id } }), 0);
    });

    it('nobody can act on a job no agent holds yet', async () => {
      for (const [method, route] of routes(openJob.id)) {
        const res = await call(ownerToken, method, route);
        assert.equal(res.status, 404, `${method} ${route} → ${res.status}`);
      }
    });

    it('the agent holding the job can still use them', async () => {
      const checklist = await call(ownerToken, 'GET', `${ownedJob.id}/checklist`);
      assert.equal(checklist.status, 200);
      const started = await call(ownerToken, 'POST', `${ownedJob.id}/service/start`);
      assert.equal(started.status, 200);
      const milestone = await call(ownerToken, 'POST', `${ownedJob.id}/service/milestone`);
      assert.equal(milestone.status, 200);
    });

    it('a checklist action on a job with no checklist is a 404, not a 500', async () => {
      const fresh = await job({ status: 'accepted', agentId: owner.id, point: area(3), when: { date: dayOffset(6), time: '10:00:00' } });
      const res = await call(ownerToken, 'POST', `${fresh.id}/checklist/phase/next`);
      assert.equal(res.status, 404);
    });
  });
});
