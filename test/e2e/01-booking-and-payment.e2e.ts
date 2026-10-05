import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Factory, Harness, area, dayOffset, north, offersOf, reload, rejectsWith, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { CustomerAddressesService } from 'src/customer/addresses/addresses.service';
import { CustomerBookingsService } from 'src/customer/bookings/bookings.service';
import { CustomerPaymentsService } from 'src/customer/payments/payments.service';

describe('Booking creation and payment', () => {
  let h: Harness;
  let f: Factory;
  let bookings: CustomerBookingsService;
  let payments: CustomerPaymentsService;
  let addresses: CustomerAddressesService;
  let cleaning: E.Service;
  let cleaningSkill: E.Skill;

  before(async () => {
    h = await startApp();
    f = new Factory(h);
    bookings = h.get(CustomerBookingsService);
    payments = h.get(CustomerPaymentsService);
    addresses = h.get(CustomerAddressesService);
    cleaning = await f.service('Home Cleaning', 300, 60);
    cleaningSkill = await f.skill('Cleaning', 'cleaning');
  });
  after(() => h.close());

  describe('creating a booking', () => {
    it('saves an address with its H3 cell', async () => {
      const { user } = await f.customer();
      const saved = await addresses.create(user.id, {
        addressLine1: 'A-1',
        city: 'Delhi',
        latitude: 28.61,
        longitude: 77.2,
      } as never);
      const row = await h.repo(E.CustomerAddress).findOneByOrFail({ id: saved.id });
      assert.ok(row.h3Cell, 'h3 cell is set');
    });

    it('creates a booking in finding with a pending payment, priced items and a start OTP', async () => {
      const { user, customer } = await f.customer();
      const address = await f.address(customer.id, area(1));
      const created = await bookings.create(user.id, {
        addressId: address.id,
        bookingDate: dayOffset(1),
        startTime: '10:00',
        items: [{ serviceId: cleaning.id }],
      } as never);
      const booking = await h.repo(E.Booking).findOneOrFail({
        where: { id: created.id },
        relations: ['items', 'payment'],
      });
      assert.equal(booking.status, 'finding');
      assert.equal(booking.paymentStatus, 'PENDING');
      assert.equal(booking.payment?.paymentStatus, 'PENDING');
      assert.equal(Number(booking.totalAmount), 300);
      assert.equal(booking.items.length, 1);
      assert.match(booking.startOtp ?? '', /^\d{4}$/);
    });

    it('rejects a booking date in the past', async () => {
      const { user, customer } = await f.customer();
      const address = await f.address(customer.id, area(1));
      await rejectsWith(
        bookings.create(user.id, {
          addressId: address.id,
          bookingDate: dayOffset(-1),
          startTime: '10:00',
          items: [{ serviceId: cleaning.id }],
        } as never),
        400,
      );
    });

    it('rejects an address with neither a service zone nor a map pin', async () => {
      const { user, customer } = await f.customer();
      // The NCR zones are seeded at boot, so use a city and pincode none of them cover.
      const address = await f.address(customer.id, null, { pincode: '999999', city: 'Nowhere' });
      await rejectsWith(
        bookings.create(user.id, {
          addressId: address.id,
          bookingDate: dayOffset(1),
          startTime: '10:00',
          items: [{ serviceId: cleaning.id }],
        } as never),
        400,
      );
    });

    it('accepts an address with a map pin even when no zone covers it', async () => {
      const { user, customer } = await f.customer();
      const address = await f.address(customer.id, area(2));
      const created = await bookings.create(user.id, {
        addressId: address.id,
        bookingDate: dayOffset(1),
        startTime: '11:00',
        items: [{ serviceId: cleaning.id }],
      } as never);
      assert.equal(created.status, 'finding');
    });

    it('creates a 7-day cook plan with one visit per day, the first sharing the start OTP', async () => {
      const { user, customer } = await f.customer();
      const address = await f.address(customer.id, area(3));
      const category = await h.repo(E.HomeCategory).save({
        title: 'Healthy Cook',
        isActive: true,
      } as Partial<E.HomeCategory>);
      const created = await bookings.createPlan(user.id, {
        categoryId: category.id,
        tierIndex: 0,
        addressId: address.id,
        bookingDate: dayOffset(2),
        durationDays: 7,
      } as never);
      const booking = await reload(h, created.id);
      const visits = await h.repo(E.BookingVisit).find({
        where: { bookingId: booking.id },
        order: { visitDate: 'ASC' },
      });
      assert.equal(booking.planType, 'MONTHLY');
      assert.equal(visits.length, 7);
      assert.equal(String(visits[0].visitDate).slice(0, 10), dayOffset(2));
      assert.equal(visits[0].otp, booking.startOtp);
    });

    it('rejects a cook plan starting today', async () => {
      const { user, customer } = await f.customer();
      const address = await f.address(customer.id, area(3));
      const category = await h.repo(E.HomeCategory).save({
        title: 'Healthy Cook',
        isActive: true,
      } as Partial<E.HomeCategory>);
      await rejectsWith(
        bookings.createPlan(user.id, {
          categoryId: category.id,
          tierIndex: 0,
          addressId: address.id,
          bookingDate: dayOffset(0),
          durationDays: 7,
        } as never),
        400,
      );
    });
  });

  describe('paying for it', () => {
    async function unpaidBooking(index: number) {
      const { user, customer } = await f.customer();
      const base = area(index);
      await f.agent(`near-${index}`, { live: north(base, 1), skills: [cleaningSkill] });
      const address = await f.address(customer.id, base);
      const created = await bookings.create(user.id, {
        addressId: address.id,
        bookingDate: dayOffset(1),
        startTime: '10:00',
        items: [{ serviceId: cleaning.id }],
      } as never);
      return { user, bookingId: created.id as string };
    }

    it('creates a stub order, then verify marks it paid and dispatch offers it to a nearby agent', async () => {
      const { user, bookingId } = await unpaidBooking(4);
      const order = await payments.createOrder(user.id, { bookingId } as never);
      assert.equal(order.mode, 'stub');

      await payments.verify(user.id, {
        bookingId,
        razorpayOrderId: order.orderId,
        razorpayPaymentId: 'pay_test_1',
      } as never);
      const booking = await reload(h, bookingId);
      assert.equal(booking.status, 'paid');
      assert.equal(booking.paymentStatus, 'PAID');
      assert.deepEqual(await offersOf(h, f, bookingId), ['near-4:1:pending']);
    });

    it('refuses a second order once paid', async () => {
      const { user, bookingId } = await unpaidBooking(5);
      const order = await payments.createOrder(user.id, { bookingId } as never);
      await payments.verify(user.id, { bookingId, razorpayOrderId: order.orderId, razorpayPaymentId: 'p' } as never);
      await rejectsWith(payments.createOrder(user.id, { bookingId } as never), 400);
    });

    it('treats verify + a captured webhook for the same payment as one payment (no duplicate offers)', async () => {
      const { user, bookingId } = await unpaidBooking(6);
      const order = await payments.createOrder(user.id, { bookingId } as never);
      await payments.verify(user.id, { bookingId, razorpayOrderId: order.orderId, razorpayPaymentId: 'p' } as never);
      const body = { event: 'payment.captured', payload: { payment: { entity: { id: 'p', order_id: order.orderId } } } };
      await payments.handleWebhook(JSON.stringify(body), undefined, body);
      const booking = await reload(h, bookingId);
      assert.equal(booking.status, 'paid');
      assert.deepEqual(await offersOf(h, f, bookingId), ['near-6:1:pending']);
    });

    it('marks the payment paid from the webhook alone when the app never called verify', async () => {
      const { user, bookingId } = await unpaidBooking(7);
      const order = await payments.createOrder(user.id, { bookingId } as never);
      const body = { event: 'payment.captured', payload: { payment: { entity: { id: 'p2', order_id: order.orderId } } } };
      await payments.handleWebhook(JSON.stringify(body), undefined, body);
      assert.equal((await reload(h, bookingId)).status, 'paid');
    });

    it('records a failed payment without moving the booking out of finding', async () => {
      const { user, bookingId } = await unpaidBooking(8);
      const order = await payments.createOrder(user.id, { bookingId } as never);
      const body = { event: 'payment.failed', payload: { payment: { entity: { id: 'p3', order_id: order.orderId } } } };
      await payments.handleWebhook(JSON.stringify(body), undefined, body);
      const booking = await reload(h, bookingId);
      assert.equal(booking.status, 'finding');
      assert.equal(booking.paymentStatus, 'FAILED');
    });

    it('hands a booking that already had an agent straight to them on payment', async () => {
      const { customer } = await f.customer();
      const agent = await f.agent('pre-assigned', { live: area(9), skills: [cleaningSkill] });
      const booking = await f.booking({
        customerId: customer.id,
        service: cleaning,
        point: area(9),
        when: { date: dayOffset(1), time: '10:00:00' },
        status: 'finding',
        agentId: agent.id,
      });
      await (payments as unknown as { settleBooking: (b: E.Booking, by: null, r: string) => Promise<void> })
        .settleBooking(await reload(h, booking.id), null, 'Payment captured');
      const after = await reload(h, booking.id);
      assert.equal(after.status, 'accepted');
      assert.equal(after.agentId, agent.id);
    });

    it('keeps PAID when a failure event for an earlier attempt arrives late', { todo: 'known bug: payment.failed overwrites PAID' }, async () => {
      const { user, bookingId } = await unpaidBooking(10);
      const order = await payments.createOrder(user.id, { bookingId } as never);
      await payments.verify(user.id, { bookingId, razorpayOrderId: order.orderId, razorpayPaymentId: 'ok' } as never);
      const body = { event: 'payment.failed', payload: { payment: { entity: { id: 'old', order_id: order.orderId } } } };
      await payments.handleWebhook(JSON.stringify(body), undefined, body);
      assert.equal((await reload(h, bookingId)).paymentStatus, 'PAID');
    });
  });
});
