import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Factory,
  Harness,
  area,
  asSuperAdmin,
  dayOffset,
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
import { BATHROOM_SKILL_CODE } from 'src/dispatch/dispatch.rules';

describe('Bathroom cleaning', () => {
  let h: Harness;
  let f: Factory;
  let dispatch: DispatchService;
  let agentBookings: AgentBookingsService;
  let admin: AdminBookingsService;
  let customer: E.Customer;
  let adminId: string;
  let bathroom: E.Service;
  let homeCleaning: E.Service;
  let bathroomAgent: E.Agent;
  let homeAgent: E.Agent;
  const base = area(1);
  const lead = process.env.SCHEDULED_DISPATCH_LEAD_MINUTES;

  before(async () => {
    // Tomorrow's jobs go out now, so dispatch can be checked without waiting for the slot.
    process.env.SCHEDULED_DISPATCH_LEAD_MINUTES = String(3 * 24 * 60);
    h = await startApp();
    f = new Factory(h);
    dispatch = h.get(DispatchService);
    agentBookings = h.get(AgentBookingsService);
    admin = h.get(AdminBookingsService);
    ({ customer } = await f.customer());
    adminId = (await f.admin()).id;
    bathroom = await f.service('Bathroom Deep Clean');
    homeCleaning = await f.service('Home Cleaning');
    const homeSkill = await f.skill('Home Cleaning', 'home cleaning,cleaning,maid,mop,dust');
    const bathroomSkill = await f.skill('Bathroom Cleaning', 'bathroom,washroom,toilet', BATHROOM_SKILL_CODE);
    bathroomAgent = await f.agent('bath', { live: north(base, 0.4), skills: [bathroomSkill] });
    homeAgent = await f.agent('home', { live: north(base, 0.6), skills: [homeSkill] });
    await f.agent('both', { live: north(base, 0.8), skills: [homeSkill, bathroomSkill] });
    await f.agent('none', { live: north(base, 1.0) });
  });
  after(async () => {
    await h.close();
    if (lead === undefined) delete process.env.SCHEDULED_DISPATCH_LEAD_MINUTES;
    else process.env.SCHEDULED_DISPATCH_LEAD_MINUTES = lead;
  });

  const job =(service: E.Service, time = '10:00:00') =>
    f.booking({ customerId: customer.id, service, point: base, when: { date: dayOffset(1), time }, planType: 'HOURLY' });

  it('offers an On Demand bathroom job only to agents with the Bathroom Cleaning skill', async () => {
    const booking = await job(bathroom);
    await dispatch.kick(booking.id);
    assert.deepEqual(await offersOf(h, f, booking.id), ['bath:1:pending', 'both:1:pending']);
  });

  it('still offers On Demand home cleaning to every nearby agent', async () => {
    const booking = await job(homeCleaning, '13:00:00');
    await dispatch.kick(booking.id);
    assert.deepEqual(await offersOf(h, f, booking.id), [
      'bath:1:pending',
      'both:1:pending',
      'home:1:pending',
      'none:1:pending',
    ]);
  });

  it('keeps bathroom jobs out of the open list of agents without the skill', async () => {
    const booking = await job(bathroom, '16:00:00');
    const openFor = async (agent: E.Agent) =>
      ((await agentBookings.list(agent.userId, { scope: 'available', limit: 50 } as never)).items as Array<{ id: string }>)
        .map((item) => item.id);
    assert.ok((await openFor(bathroomAgent)).includes(booking.id));
    assert.ok(!(await openFor(homeAgent)).includes(booking.id));
  });

  it("won't let an agent without the skill accept a bathroom job", async () => {
    const booking = await job(bathroom, '18:00:00');
    await rejectsWith(agentBookings.accept(homeAgent.userId, booking.id), 403);
    assert.equal((await reload(h, booking.id)).agentId, null);
    await agentBookings.accept(bathroomAgent.userId, booking.id);
    assert.equal((await reload(h, booking.id)).status, 'accepted');
  });

  it("won't let an admin assign a bathroom job to an agent without the skill", async () => {
    const booking = await job(bathroom, '19:30:00');
    await rejectsWith(
      asSuperAdmin(() => admin.assignAgent(adminId, booking.id, { agentId: homeAgent.id } as never)),
      400,
    );
    const both = await h.repo(E.Agent).findOneByOrFail({ firstName: 'both' });
    await asSuperAdmin(() => admin.assignAgent(adminId, booking.id, { agentId: both.id } as never));
    assert.equal((await reload(h, booking.id)).agentId, both.id);
    await rejectsWith(
      asSuperAdmin(() => admin.reassignAgent(adminId, booking.id, { agentId: homeAgent.id, reason: 'swap' } as never)),
      400,
    );
  });

  it('shows the customer phone to the assigned agent in their job list', async () => {
    const booking = await job(homeCleaning, '08:00:00');
    await agentBookings.accept(homeAgent.userId, booking.id);
    const mine = (await agentBookings.list(homeAgent.userId, { scope: 'assigned', limit: 50 } as never)).items as Array<{
      id: string;
      customerMobile: string | null;
    }>;
    const user = await h.repo(E.User).findOneByOrFail({ id: customer.userId });
    assert.equal(mine.find((item) => item.id === booking.id)?.customerMobile, user.mobile);
  });
});
