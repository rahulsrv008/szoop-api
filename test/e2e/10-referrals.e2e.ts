import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Factory, Harness, asSuperAdmin, rejectsWith, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { ReferralService } from 'src/common/referrals/referral.service';
import { SETTING_KEYS, SettingsService } from 'src/common/services/settings.service';
import { AgentRegistrationService } from 'src/agent/registration/registration.service';
import { AgentReferralsService } from 'src/agent/referrals/referrals.service';
import { AdminAgentsService } from 'src/admin/agents/agents.service';
import { todayString } from 'src/agent/shared/date.util';

describe('Agent referrals: employee IDs and referral codes', () => {
  let h: Harness;
  let f: Factory;
  let referrals: ReferralService;
  let settings: SettingsService;

  before(async () => {
    h = await startApp();
    f = new Factory(h);
    referrals = h.get(ReferralService);
    settings = h.get(SettingsService);
  });
  after(() => h.close());

  beforeEach(async () => {
    await settings.set(SETTING_KEYS.REFERRAL_ENABLED, true);
    await settings.set(SETTING_KEYS.REFERRAL_MAX_PER_AGENT, 3);
  });

  /** An approved agent holding an employee ID (the factory doesn't assign one). */
  const referrer = async (name: string) => {
    const agent = await f.agent(name);
    agent.employeeId = await referrals.assignEmployeeId(agent.id);
    return agent;
  };
  const newAgent = (name: string) => f.agent(name, { approvalStatus: 'PENDING', status: 'PENDING' });
  const signUp = (agent: E.Agent, referralCode?: string) =>
    h.get(AgentRegistrationService).register(agent.userId, { firstName: agent.firstName, referralCode });
  const reloadAgent = (id: string) => h.repo(E.Agent).findOneByOrFail({ id });
  const display = (id: string) => `${id.slice(0, 4)}-${id.slice(4)}`;

  it('employee ID: SZ + year + 5 unambiguous characters, assigned once', async () => {
    const agent = await referrer('id-format');
    const year = todayString().slice(2, 4);
    assert.match(agent.employeeId!, new RegExp(`^SZ${year}[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}$`));
    assert.equal(await referrals.assignEmployeeId(agent.id), agent.employeeId, 'never reassigned');
  });

  it('approving an agent gives them an employee ID', async () => {
    const agent = await newAgent('to-approve');
    const zone = await f.zone();
    const admin = await f.admin();
    await h.repo(E.AgentDocument).save({ agentId: agent.id, documentType: 'PAN', documentUrl: 'data:image/jpeg;base64,AA==' } as never);
    await h.repo(E.AgentBankAccount).save({ agentId: agent.id, accountNumber: '1234567890', ifscCode: 'HDFC0000001' } as never);
    const result = await asSuperAdmin(() =>
      h.get(AdminAgentsService).approve(admin.id, agent.id, { serviceAreaIds: [zone.id] } as never),
    );
    const saved = await reloadAgent(agent.id);
    assert.ok(saved.employeeId);
    assert.equal(result.employeeId, display(saved.employeeId!));
  });

  it('saving an agent loaded before the ID was assigned does not clear it', async () => {
    const agent = await f.agent('stale-save');
    const stale = await reloadAgent(agent.id);
    const id = await referrals.assignEmployeeId(agent.id);
    stale.firstName = 'renamed';
    await h.repo(E.Agent).save(stale);
    assert.equal((await reloadAgent(agent.id)).employeeId, id);
  });

  it('signing up with a code (any case, with a dash) links the new agent and uses one invite', async () => {
    const amit = await referrer('Amit');
    const ravi = await newAgent('Ravi');
    const typed = display(amit.employeeId!).toLowerCase();

    const check = await h.get(AgentReferralsService).validate(ravi.userId, typed);
    assert.deepEqual(check, { valid: true, referrerName: 'Amit' });

    await signUp(ravi, typed);
    assert.equal((await reloadAgent(ravi.id)).referredByAgentId, amit.id);
    const rows = await h.repo(E.AgentReferral).findBy({ referrerAgentId: amit.id });
    assert.deepEqual(rows.map((row) => [row.refereeAgentId, row.status]), [[ravi.id, 'JOINED']]);

    await signUp(ravi, amit.employeeId!);
    assert.equal(await h.repo(E.AgentReferral).countBy({ referrerAgentId: amit.id }), 1, 're-sending the same code is a no-op');
  });

  it('a second, different code is refused', async () => {
    const first = await referrer('first');
    const second = await referrer('second');
    const agent = await newAgent('two-codes');
    await signUp(agent, first.employeeId!);
    const message = await rejectsWith(signUp(agent, second.employeeId!), 409);
    assert.match(message, /already been applied/);
    assert.equal((await reloadAgent(agent.id)).referredByAgentId, first.id);
  });

  it('a code works for 3 people only, and the limit comes from settings', async () => {
    const owner = await referrer('popular');
    for (const name of ['p1', 'p2', 'p3']) await signUp(await newAgent(name), owner.employeeId!);

    const fourth = await newAgent('p4');
    const check = await h.get(AgentReferralsService).validate(fourth.userId, owner.employeeId!);
    assert.equal((check as { reason: string }).reason, 'USED_UP');
    assert.match(await rejectsWith(signUp(fourth, owner.employeeId!), 409), /used by 3 people/);
    assert.equal((await reloadAgent(fourth.id)).firstName, 'p4', 'nothing saved when the code is refused');

    await settings.set(SETTING_KEYS.REFERRAL_MAX_PER_AGENT, 4);
    await signUp(fourth, owner.employeeId!);
    assert.equal(await h.repo(E.AgentReferral).countBy({ referrerAgentId: owner.id }), 4);
  });

  it('two people racing for the last invite: exactly one gets it', async () => {
    await settings.set(SETTING_KEYS.REFERRAL_MAX_PER_AGENT, 1);
    const owner = await referrer('race-owner');
    const [a, b] = [await newAgent('racer-a'), await newAgent('racer-b')];
    const results = await Promise.allSettled([signUp(a, owner.employeeId!), signUp(b, owner.employeeId!)]);
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(await h.repo(E.AgentReferral).countBy({ referrerAgentId: owner.id }), 1);
  });

  it('refuses bad, inactive and own codes, and codes for agents who are not new', async () => {
    const owner = await referrer('checks-owner');
    const agent = await newAgent('checks-new');
    const reason = async (who: E.Agent, code: string) =>
      ((await h.get(AgentReferralsService).validate(who.userId, code)) as { reason?: string }).reason;

    assert.equal(await reason(agent, 'SZ26XXXXX'), 'INVALID');
    assert.equal(await reason(owner, owner.employeeId!), 'NOT_NEW_AGENT');

    const suspended = await referrer('suspended-owner');
    await h.repo(E.Agent).update({ id: suspended.id }, { status: 'SUSPENDED' });
    assert.equal(await reason(agent, suspended.employeeId!), 'INACTIVE');

    await settings.set(SETTING_KEYS.REFERRAL_ENABLED, false);
    assert.equal(await reason(agent, owner.employeeId!), 'PROGRAM_OFF');
    await rejectsWith(signUp(agent, owner.employeeId!), 400);
    assert.equal((await reloadAgent(agent.id)).referredByAgentId, null);
  });

  it('Refer & Earn overview: code, invites left, people invited with their job progress', async () => {
    const owner = await referrer('overview-owner');
    const invitee = await newAgent('Suresh');
    await h.repo(E.Agent).update({ id: invitee.id }, { lastName: 'yadav' });
    await signUp(invitee, owner.employeeId!);

    const { customer } = await f.customer();
    const service = await f.service('Cleaning');
    for (const status of ['completed', 'completed', 'cancelled'] as const) {
      await f.booking({ customerId: customer.id, service, point: null, when: { date: todayString(), time: '10:00' }, status, agentId: invitee.id });
    }

    const overview = await h.get(AgentReferralsService).overview(owner.userId);
    assert.equal(overview.employeeId, display(owner.employeeId!));
    assert.deepEqual(overview.invites, { used: 1, max: 3, remaining: 2 });
    assert.equal(overview.jobsToQualify, 5);
    assert.deepEqual(
      overview.invited.map((row) => [row.name, row.status, row.jobsCompleted]),
      [['Suresh Y.', 'JOINED', 2]],
    );
  });

  it('admin: search by employee ID however typed, and see who referred an agent', async () => {
    const owner = await referrer('admin-owner');
    const invitee = await newAgent('admin-invitee');
    await signUp(invitee, owner.employeeId!);
    const admin = h.get(AdminAgentsService);

    const typed = display(owner.employeeId!).toLowerCase().slice(0, 7);
    const list = await asSuperAdmin(() => admin.list({ search: typed } as never));
    assert.ok(list.items.some((row) => row.agentId === owner.id && row.employeeId === display(owner.employeeId!)));

    const detail = await asSuperAdmin(() => admin.detail(invitee.id));
    assert.deepEqual(detail.referredBy, {
      agentId: owner.id,
      name: 'admin-owner',
      employeeId: display(owner.employeeId!),
    });
  });
});
