import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Factory, Harness, area, at, dayOffset, north, offersOf, reload, rejectsWith, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { CustomerAddressesService } from 'src/customer/addresses/addresses.service';
import { CustomerBookingsService } from 'src/customer/bookings/bookings.service';
import { CustomerPaymentsService } from 'src/customer/payments/payments.service';
import { DispatchService } from 'src/dispatch/dispatch.service';
import { AgentBookingsService } from 'src/agent/bookings/bookings.service';
import { WalletService } from 'src/common/services/wallet.service';

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

      const verified = await payments.verify(user.id, {
        bookingId,
        razorpayOrderId: order.orderId,
        razorpayPaymentId: 'pay_test_1',
      } as never);
      assert.equal(verified.transactionId, 'pay_test_1');
      const customerBooking = await bookings.detail(user.id, bookingId);
      assert.equal(customerBooking.payment?.transactionId, 'pay_test_1');
      const capturedTransaction = await h.repo(E.PaymentTransaction).findOneByOrFail({
        paymentId: customerBooking.payment!.id,
        gatewayTransactionId: 'pay_test_1',
        status: 'captured',
      });
      assert.equal(capturedTransaction.gatewayTransactionId, 'pay_test_1');
      const booking = await reload(h, bookingId);
      assert.equal(booking.status, 'paid');
      assert.equal(booking.paymentStatus, 'PAID');
      assert.deepEqual(await offersOf(h, f, bookingId), ['near-4:1:pending']);
    });

    it('rejects a payment callback for an order not created for that booking', async () => {
      const { user, bookingId } = await unpaidBooking(41);
      await payments.createOrder(user.id, { bookingId } as never);
      await rejectsWith(
        payments.verify(user.id, {
          bookingId,
          razorpayOrderId: 'order_not_created_for_booking',
          razorpayPaymentId: 'pay_test_invalid_order',
        } as never),
        400,
      );
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
      await h.repo(E.Booking).update({ id: booking.id }, { paymentStatus: 'PENDING' });
      const { user } = await h.repo(E.Customer).findOneOrFail({ where: { id: customer.id }, relations: ['user'] });
      const order = await payments.createOrder(user.id, { bookingId: booking.id } as never);
      await payments.verify(user.id, { bookingId: booking.id, razorpayOrderId: order.orderId, razorpayPaymentId: 'p' } as never);
      const after = await reload(h, booking.id);
      assert.equal(after.status, 'accepted');
      assert.equal(after.agentId, agent.id);
    });

    it('keeps PAID when a failure event for an earlier attempt arrives late', async () => {
      const { user, bookingId } = await unpaidBooking(10);
      const order = await payments.createOrder(user.id, { bookingId } as never);
      await payments.verify(user.id, { bookingId, razorpayOrderId: order.orderId, razorpayPaymentId: 'ok' } as never);
      const body = { event: 'payment.failed', payload: { payment: { entity: { id: 'old', order_id: order.orderId } } } };
      await payments.handleWebhook(JSON.stringify(body), undefined, body);
      assert.equal((await reload(h, bookingId)).paymentStatus, 'PAID');
    });
  });

  describe('payments on closed bookings', () => {
    const captured = (orderId: string) => ({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'late', order_id: orderId } } },
    });
    const credits = (bookingId: string) => h.repo(E.WalletTransaction).countBy({ bookingId });
    const unpaid = async (index: number, service: E.Service = cleaning) => {
      const { user, customer } = await f.customer();
      const address = await f.address(customer.id, area(index));
      const created = await bookings.create(user.id, {
        addressId: address.id,
        bookingDate: dayOffset(1),
        startTime: '10:00',
        items: [{ serviceId: service.id }],
      } as never);
      return { user, customer, bookingId: created.id as string };
    };

    it('a capture arriving after the customer cancelled keeps it refunded, credited once', async () => {
      const { user, bookingId } = await unpaid(11);
      const order = await payments.createOrder(user.id, { bookingId } as never);
      await payments.verify(user.id, { bookingId, razorpayOrderId: order.orderId, razorpayPaymentId: 'p' } as never);
      await bookings.cancel(user.id, bookingId, {} as never);
      const body = captured(order.orderId);
      await payments.handleWebhook(JSON.stringify(body), undefined, body);

      const booking = await reload(h, bookingId);
      assert.equal(booking.status, 'cancelled');
      assert.equal(booking.paymentStatus, 'REFUNDED');
      assert.equal((await h.repo(E.Payment).findOneByOrFail({ bookingId })).paymentStatus, 'REFUNDED');
      assert.equal(await credits(bookingId), 1);
    });

    it('a failure event after a refund leaves it refunded', async () => {
      const { user, bookingId } = await unpaid(12);
      const order = await payments.createOrder(user.id, { bookingId } as never);
      await payments.verify(user.id, { bookingId, razorpayOrderId: order.orderId, razorpayPaymentId: 'p' } as never);
      await bookings.cancel(user.id, bookingId, {} as never);
      const body = { event: 'payment.failed', payload: { payment: { entity: { id: 'old', order_id: order.orderId } } } };
      await payments.handleWebhook(JSON.stringify(body), undefined, body);
      assert.equal((await reload(h, bookingId)).paymentStatus, 'REFUNDED');
    });

    it('refuses a new order for a cancelled booking', async () => {
      const { user, bookingId } = await unpaid(13);
      await bookings.cancel(user.id, bookingId, {} as never);
      await rejectsWith(payments.createOrder(user.id, { bookingId } as never), 400);
    });

    it('money captured for a booking cancelled before payment goes to the wallet', async () => {
      const { user, customer, bookingId } = await unpaid(14);
      const order = await payments.createOrder(user.id, { bookingId } as never);
      await bookings.cancel(user.id, bookingId, {} as never);
      assert.equal((await reload(h, bookingId)).paymentStatus, 'VOIDED');

      const body = captured(order.orderId);
      await payments.handleWebhook(JSON.stringify(body), undefined, body);
      const booking = await reload(h, bookingId);
      assert.equal(booking.status, 'cancelled');
      assert.equal(booking.paymentStatus, 'REFUNDED');
      const credit = await h.repo(E.WalletTransaction).findOneByOrFail({ bookingId });
      assert.equal(Number(credit.amount), Number(booking.totalAmount));
      assert.equal(credit.customerId, customer.id);
    });

    const timedOut = (bookingId: string) =>
      h.ds.query(`UPDATE bookings SET created_at = now() - interval '16 minutes' WHERE id = $1`, [bookingId]);

    it('an unpaid request is voided after 15 minutes: never confirmed, nothing to refund, not listed', async () => {
      const { user, bookingId } = await unpaid(16);
      await timedOut(bookingId);
      await h.get(DispatchService).tick();

      const booking = await reload(h, bookingId);
      assert.equal(booking.status, 'cancelled');
      assert.equal(booking.paymentStatus, 'VOIDED');
      assert.equal(await credits(bookingId), 0);
      const listed = await bookings.list(user.id, {} as never);
      assert.ok(!listed.items.some((item) => item.id === bookingId));
    });

    it('refuses a new order once the request has timed out, even before it is voided', async () => {
      const { user, bookingId } = await unpaid(17);
      await timedOut(bookingId);
      await rejectsWith(payments.createOrder(user.id, { bookingId } as never), 400);
    });

    it('money that arrives after the request timed out goes to the wallet', async () => {
      const { user, bookingId } = await unpaid(18);
      const order = await payments.createOrder(user.id, { bookingId } as never);
      await timedOut(bookingId);
      await h.get(DispatchService).tick();
      await payments.verify(user.id, { bookingId, razorpayOrderId: order.orderId, razorpayPaymentId: 'late' } as never);

      const booking = await reload(h, bookingId);
      assert.equal(booking.status, 'cancelled');
      assert.equal(booking.paymentStatus, 'REFUNDED');
      assert.equal(await credits(bookingId), 1);
      const listed = await bookings.list(user.id, {} as never);
      assert.equal(listed.items.find((item) => item.id === bookingId)?.refundedToWallet, Number(booking.totalAmount));
    });

    it('lists only confirmed bookings: an open unpaid request is not one', async () => {
      const { user, bookingId } = await unpaid(19);
      assert.ok(!(await bookings.list(user.id, {} as never)).items.some((item) => item.id === bookingId));
      const order = await payments.createOrder(user.id, { bookingId } as never);
      await payments.verify(user.id, { bookingId, razorpayOrderId: order.orderId, razorpayPaymentId: 'p' } as never);
      assert.ok((await bookings.list(user.id, {} as never)).items.some((item) => item.id === bookingId));
    });

    describe('coupons', () => {
      const coupon = (code: string) =>
        h.repo(E.Coupon).save({
          code,
          discountType: 'FLAT',
          discountValue: '50.00',
          usageLimit: 1,
          usedCount: 0,
          isActive: true,
        } as Partial<E.Coupon>);
      const bookWith = async (customerId: string, userId: string, index: number, code: string) => {
        const address = await f.address(customerId, area(index));
        return bookings.create(userId, {
          addressId: address.id,
          bookingDate: dayOffset(1),
          startTime: '10:00',
          items: [{ serviceId: cleaning.id }],
          couponCode: code,
        } as never);
      };
      const used = async (code: string) => (await h.repo(E.Coupon).findOneByOrFail({ code })).usedCount;

      it('a cancelled paid booking gives its coupon back, and the customer is told', async () => {
        await coupon('BACK50');
        const { user, customer } = await f.customer();
        const first = await bookWith(customer.id, user.id, 20, 'BACK50');
        const order = await payments.createOrder(user.id, { bookingId: first.id } as never);
        await payments.verify(user.id, { bookingId: first.id, razorpayOrderId: order.orderId, razorpayPaymentId: 'p' } as never);
        assert.equal(await used('BACK50'), 1);
        await rejectsWith(bookWith(customer.id, user.id, 21, 'BACK50'), 400);

        const result = (await bookings.cancel(user.id, first.id, {} as never)) as { releasedCoupons: string[] };
        assert.deepEqual(result.releasedCoupons, ['BACK50']);
        assert.equal(await used('BACK50'), 0);
        assert.equal(await h.repo(E.CouponUsage).countBy({ bookingId: first.id }), 0);
        const notice = await h.repo(E.Notification).findOneByOrFail({ userId: user.id, notificationType: 'wallet_refund' });
        assert.match(notice.message ?? '', /coupon BACK50 can be used again/);

        const again = await bookWith(customer.id, user.id, 22, 'BACK50');
        assert.equal(Number(again.discount), 50);
        assert.equal(await used('BACK50'), 1);
      });

      it('an unpaid request that times out gives its coupon back', async () => {
        await coupon('TIMEOUT50');
        const { user, customer } = await f.customer();
        const request = await bookWith(customer.id, user.id, 23, 'TIMEOUT50');
        await timedOut(request.id);
        await h.get(DispatchService).tick();
        assert.equal((await reload(h, request.id)).status, 'cancelled');
        assert.equal(await used('TIMEOUT50'), 0);
      });
    });

    describe('pay after service', () => {
      const jobs = () => h.get(AgentBookingsService);
      const wallet = () => h.get(WalletService);
      const pay = async (userId: string, bookingId: string) => {
        const order = await payments.createOrder(userId, { bookingId } as never);
        await payments.verify(userId, { bookingId, razorpayOrderId: order.orderId, razorpayPaymentId: 'p' } as never);
      };
      /** A request whose online payment was tried (an order exists) and then switched to pay after service. */
      /** ₹150: within the ₹200 pay-after-service limit. */
      let quick: E.Service;
      before(async () => {
        quick = await f.service('Quick Clean', 150, 60);
      });
      /** Three online attempts (one order each) that never got paid. */
      const failThrice = async (userId: string, bookingId: string) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await payments.createOrder(userId, { bookingId } as never);
        }
      };
      /** A ₹150 request whose 3 online attempts failed, then confirmed as pay after service. */
      const confirmedUnpaid = async (index: number) => {
        const { user, customer, bookingId } = await unpaid(index, quick);
        await failThrice(user.id, bookingId);
        await bookings.payAfterService(user.id, bookingId);
        return { user, customer, bookingId };
      };
      /** Hands the job to an agent and starts it. */
      const inProgress = async (bookingId: string, index: number) => {
        const agent = await f.agent(`pas-${index}`, { live: area(index), skills: [cleaningSkill] });
        await h.repo(E.Booking).update({ id: bookingId }, { agentId: agent.id, status: 'ongoing' });
        return agent;
      };

      it('is offered only after 3 failed attempts, and confirms the booking unpaid', async () => {
        const { user, bookingId } = await unpaid(30, quick);
        await rejectsWith(bookings.payAfterService(user.id, bookingId), 400);
        await payments.createOrder(user.id, { bookingId } as never);
        await payments.createOrder(user.id, { bookingId } as never);
        await rejectsWith(bookings.payAfterService(user.id, bookingId), 400);

        await payments.createOrder(user.id, { bookingId } as never);
        const result = await bookings.payAfterService(user.id, bookingId);
        assert.equal(result.status, 'paid');
        assert.equal(result.paymentMode, 'AFTER_SERVICE');
        const booking = await reload(h, bookingId);
        assert.equal(booking.status, 'paid');
        assert.equal(booking.paymentStatus, 'PENDING');
        assert.ok((await bookings.list(user.id, {} as never)).items.some((item) => item.id === bookingId));
      });

      it('is refused for monthly plans', async () => {
        const { user, bookingId } = await unpaid(31, quick);
        await failThrice(user.id, bookingId);
        await h.repo(E.Booking).update({ id: bookingId }, { planType: 'MONTHLY' });
        await rejectsWith(bookings.payAfterService(user.id, bookingId), 400);
      });

      it('is refused above ₹200, even after 3 failed attempts', async () => {
        const { user, bookingId } = await unpaid(39);
        assert.ok(Number((await reload(h, bookingId)).totalAmount) > 200);
        await failThrice(user.id, bookingId);
        await rejectsWith(bookings.payAfterService(user.id, bookingId), 400);
      });

      it('an unconfirmed request gets no 4th online attempt', async () => {
        const { user, bookingId } = await unpaid(40);
        await failThrice(user.id, bookingId);
        await rejectsWith(payments.createOrder(user.id, { bookingId } as never), 400);
      });

      it('the agent cannot complete until the customer pays; then they can', async () => {
        const { user, bookingId } = await confirmedUnpaid(32);
        const agent = await inProgress(bookingId, 32);

        await rejectsWith(jobs().complete(agent.userId, bookingId, {} as never), 409);
        const status = await jobs().paymentStatus(agent.userId, bookingId);
        assert.equal(status.paymentStatus, 'PENDING');
        assert.equal(status.payUrl, `clearit://pay/${bookingId}`);

        await pay(user.id, bookingId);
        assert.equal((await jobs().paymentStatus(agent.userId, bookingId)).paymentStatus, 'PAID');
        await jobs().complete(agent.userId, bookingId, {} as never);
        assert.equal((await reload(h, bookingId)).status, 'completed');
      });

      it('a refused payment completes the job and puts the amount as due in the wallet, cleared when paid', async () => {
        const { user, customer, bookingId } = await confirmedUnpaid(33);
        const agent = await inProgress(bookingId, 33);
        const before = await wallet().balance(customer.id);

        const done = (await jobs().complete(agent.userId, bookingId, { customerRefusedPayment: true } as never)) as {
          amountDue: number;
        };
        const booking = await reload(h, bookingId);
        assert.equal(booking.status, 'completed');
        assert.equal(done.amountDue, Number(booking.totalAmount));
        assert.equal(await wallet().balance(customer.id), before - Number(booking.totalAmount));
        assert.ok(await h.repo(E.Notification).findOneBy({ userId: user.id, notificationType: 'wallet_due' }));

        await pay(user.id, bookingId);
        assert.equal((await reload(h, bookingId)).paymentStatus, 'PAID');
        assert.equal(await wallet().balance(customer.id), before);
        assert.equal(await h.repo(E.WalletTransaction).countBy({ bookingId }), 2);
      });

      it('money owed blocks new bookings until it is paid', async () => {
        const { user, customer, bookingId } = await confirmedUnpaid(35);
        const agent = await inProgress(bookingId, 35);
        await jobs().complete(agent.userId, bookingId, { customerRefusedPayment: true } as never);

        const address = await f.address(customer.id, area(36));
        const book = () =>
          bookings.create(user.id, {
            addressId: address.id,
            bookingDate: dayOffset(1),
            startTime: '10:00',
            items: [{ serviceId: cleaning.id }],
          } as never);
        await rejectsWith(book(), 409);
        const statement = await wallet().statement(customer.id, { page: 1, limit: 5 });
        assert.equal(statement.dues[0].bookingId, bookingId);

        await pay(user.id, bookingId);
        assert.deepEqual((await wallet().statement(customer.id, { page: 1, limit: 5 })).dues, []);
        await book();
      });

      it('an unpaid job blocks new bookings even when refunds keep the wallet positive', async () => {
        const { user, customer, bookingId } = await confirmedUnpaid(37);
        await h.repo(E.WalletTransaction).save({
          customerId: customer.id,
          bookingId: null,
          type: 'CREDIT',
          reason: 'BOOKING_CANCELLED',
          amount: '5000.00',
        } as Partial<E.WalletTransaction>);
        const agent = await inProgress(bookingId, 37);
        await jobs().complete(agent.userId, bookingId, { customerRefusedPayment: true } as never);
        assert.ok((await wallet().balance(customer.id)) > 0);

        const address = await f.address(customer.id, area(38));
        await rejectsWith(
          bookings.create(user.id, {
            addressId: address.id,
            bookingDate: dayOffset(1),
            startTime: '10:00',
            items: [{ serviceId: cleaning.id }],
          } as never),
          409,
        );
      });

      it('cancelling it voids the payment with nothing to refund', async () => {
        const { user, bookingId } = await confirmedUnpaid(34);
        const result = (await bookings.cancel(user.id, bookingId, {} as never)) as { paymentStatus: string };
        assert.equal(result.paymentStatus, 'VOIDED');
        assert.equal(await credits(bookingId), 0);
      });
    });

    it('refuses to take payment for a "Right now" booking whose start has passed', async () => {
      const { user, customer } = await f.customer();
      const booking = await f.booking({
        customerId: customer.id,
        service: cleaning,
        point: area(15),
        when: at(-1),
        status: 'finding',
      });
      await h.repo(E.Booking).update({ id: booking.id }, { bookingMode: 'INSTANT', paymentStatus: 'PENDING' });
      await rejectsWith(payments.createOrder(user.id, { bookingId: booking.id } as never), 400);
    });
  });
});
