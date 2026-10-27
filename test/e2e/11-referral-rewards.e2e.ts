import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Factory, Harness, asSuperAdmin, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { ReferralService } from 'src/common/referrals/referral.service';
import { ReferralRewardsService } from 'src/common/referrals/referral-rewards.service';
import { SETTING_KEYS, SettingsService } from 'src/common/services/settings.service';
import { AgentRegistrationService } from 'src/agent/registration/registration.service';
import { AgentReferralsService } from 'src/agent/referrals/referrals.service';
import { AgentBookingsService } from 'src/agent/bookings/bookings.service';
import { AdminEarningsService } from 'src/admin/earnings/earnings.service';
import { toDateString, todayString } from 'src/agent/shared/date.util';

describe('Agent referrals: rewards when a referee completes 5 jobs', () => {
  let h: Harness;
  let f: Factory;
  let rewards: ReferralRewardsService;
  let settings: SettingsService;
  let customerId: string;
  let service: E.Service;

  before(async () => {
    h = await startApp();
    f = new Factory(h);
    rewards = h.get(ReferralRewardsService);
    settings = h.get(SettingsService);
    customerId = (await f.customer()).customer.id;
    service = await f.service('Cleaning');
  });
  after(() => h.close());

  beforeEach(async () => {
    const values: [string, unknown][] = [
      [SETTING_KEYS.REFERRAL_ENABLED, true],
      [SETTING_KEYS.REFERRAL_MAX_PER_AGENT, 3],
      [SETTING_KEYS.REFERRAL_MAX_LEVELS, 3],
      [SETTING_KEYS.REFERRAL_REWARD_TIERS, [300, 500, 700]],
      [SETTING_KEYS.REFERRAL_LEVEL_REWARDS, [100, 50]],
      [SETTING_KEYS.REFERRAL_MAX_EARNING, 5000],
      [SETTING_KEYS.REFERRAL_QUALIFY_JOBS, 5],
      [SETTING_KEYS.REFERRAL_JOINING_BONUS, 200],
      [SETTING_KEYS.REFERRAL_ACTIVE_MIN_JOBS, 10],
      [SETTING_KEYS.REFERRAL_ACTIVE_WINDOW_DAYS, 30],
    ];
    for (const [key, value] of values) await settings.set(key, value);
  });

  const daysAgo = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return toDateString(date);
  };

  /** Completed single bookings for the agent, on `date` (today by default). */
  const doJobs = async (agent: E.Agent, count: number, date = todayString()) => {
    for (let i = 0; i < count; i += 1) {
      await f.booking({ customerId, service, point: null, when: { date, time: '10:00' }, status: 'completed', agentId: agent.id });
    }
  };

  /** An approved agent with an employee ID, optionally signed up with `referrer`'s code. */
  const agent = async (name: string, referrer?: E.Agent) => {
    const created = await f.agent(name, { approvalStatus: 'PENDING', status: 'PENDING' });
    if (referrer) {
      await h.get(AgentRegistrationService).register(created.userId, {
        firstName: name,
        referralCode: referrer.employeeId!,
      });
    }
    await h.repo(E.Agent).update({ id: created.id }, { approvalStatus: 'APPROVED', status: 'ACTIVE' });
    await h.get(ReferralService).assignEmployeeId(created.id);
    return h.repo(E.Agent).findOneByOrFail({ id: created.id });
  };

  /** The referee does the 5 qualifying jobs and the rewards are worked out. */
  const qualify = async (referee: E.Agent) => {
    await doJobs(referee, 5);
    return rewards.qualify(referee.id);
  };

  const rewardsOf = async (agentId: string) =>
    (await h.repo(E.AgentReferralReward).find({ where: { agentId }, order: { createdAt: 'ASC' } })).map((row) => ({
      type: row.type,
      level: row.level,
      amount: Number(row.amount),
      status: row.status,
      reason: row.reasonCode,
    }));

  it('nothing until the 5th job; then the referrer and the new agent both earn', async () => {
    const root = await agent('Nitish');
    const amit = await agent('Amit', root);

    await doJobs(amit, 4);
    assert.deepEqual(await rewards.qualify(amit.id), []);

    await doJobs(amit, 1);
    await rewards.qualify(amit.id);
    assert.deepEqual(await rewardsOf(root.id), [{ type: 'DIRECT', level: 1, amount: 300, status: 'PENDING', reason: null }]);
    assert.deepEqual(await rewardsOf(amit.id), [{ type: 'JOINING', level: 0, amount: 200, status: 'PENDING', reason: null }]);
    assert.equal((await h.repo(E.AgentReferral).findOneByOrFail({ refereeAgentId: amit.id })).status, 'QUALIFIED');

    const note = await h.repo(E.Notification).findOneByOrFail({ userId: root.userId, notificationType: 'referral' });
    assert.match(note.message, /Amit completed 5 jobs\. ₹300 will be paid with your salary/);

    await rewards.qualify(amit.id);
    assert.equal((await rewardsOf(root.id)).length, 1, 'a referral qualifies once');
  });

  it('level 1 pays ₹300, ₹500, ₹700 in the order referees qualify', async () => {
    const root = await agent('tiers-root');
    const [x, y, z] = [await agent('x', root), await agent('y', root), await agent('z', root)];
    await qualify(z);
    await qualify(x);
    await qualify(y);
    assert.deepEqual((await rewardsOf(root.id)).map((row) => row.amount), [300, 500, 700]);
  });

  it('team levels: paid only while active, and nothing beyond the set number of levels', async () => {
    const root = await agent('team-root');
    await doJobs(root, 12);
    const a = await agent('team-a', root);
    await qualify(a); // a now has 5 recent jobs: below the 10 needed for team rewards
    const b = await agent('team-b', a);
    await qualify(b);
    const c = await agent('team-c', b);
    await qualify(c);

    assert.deepEqual(await rewardsOf(root.id), [
      { type: 'DIRECT', level: 1, amount: 300, status: 'PENDING', reason: null },
      { type: 'NETWORK', level: 2, amount: 100, status: 'PENDING', reason: null },
      { type: 'NETWORK', level: 3, amount: 50, status: 'PENDING', reason: null },
    ]);
    const missedByA = (await h.repo(E.AgentReferralReward).findOneByOrFail({ agentId: a.id, refereeAgentId: c.id }));
    assert.equal(missedByA.status, 'MISSED');
    assert.equal(missedByA.reasonCode, 'INACTIVE');
    assert.deepEqual(missedByA.reasonDetail, { jobsDone: 5, jobsRequired: 10, windowDays: 30 });
    assert.equal(Number(missedByA.intendedAmount), 100);

    const d = await agent('team-d', c);
    await qualify(d);
    assert.equal((await rewardsOf(root.id)).length, 3, 'root is 4 levels above d');

    await settings.set(SETTING_KEYS.REFERRAL_MAX_LEVELS, 4);
    const e = await agent('team-e', c);
    await qualify(e);
    assert.deepEqual((await rewardsOf(root.id)).at(-1), { type: 'NETWORK', level: 4, amount: 50, status: 'PENDING', reason: null }, 'the last level amount repeats');
  });

  it('jobs older than the window do not count as active', async () => {
    const root = await agent('old-root');
    await doJobs(root, 12, daysAgo(40));
    const a = await agent('old-a', root);
    await qualify(a);
    const b = await agent('old-b', a);
    await qualify(b);
    const network = await h.repo(E.AgentReferralReward).findOneByOrFail({ agentId: root.id, type: 'NETWORK' });
    assert.equal(network.reasonCode, 'INACTIVE');
    assert.equal((network.reasonDetail as { jobsDone: number }).jobsDone, 0);
  });

  it('the lifetime limit cuts a reward down, then stops them', async () => {
    await settings.set(SETTING_KEYS.REFERRAL_MAX_EARNING, 1000);
    await settings.set(SETTING_KEYS.REFERRAL_ACTIVE_MIN_JOBS, 0);
    const root = await agent('cap-root');
    const [x, y, z] = [await agent('cap-x', root), await agent('cap-y', root), await agent('cap-z', root)];
    await qualify(x);
    await qualify(y);
    await qualify(z);
    const deep = await agent('cap-deep', x);
    await qualify(deep);

    const rows = await h.repo(E.AgentReferralReward).find({ where: { agentId: root.id }, order: { createdAt: 'ASC' } });
    assert.deepEqual(
      rows.map((row) => [Number(row.intendedAmount), Number(row.amount), row.status, row.reasonCode]),
      [
        [300, 300, 'PENDING', null],
        [500, 500, 'PENDING', null],
        [700, 200, 'PENDING', 'CAP_PARTIAL'],
        [100, 0, 'MISSED', 'CAP_REACHED'],
      ],
    );
  });

  it('a suspended referrer misses out; the new agent still gets the joining bonus', async () => {
    const root = await agent('suspended-root');
    const a = await agent('suspended-a', root);
    await h.repo(E.Agent).update({ id: root.id }, { status: 'SUSPENDED' });
    await qualify(a);
    assert.deepEqual(await rewardsOf(root.id), [{ type: 'DIRECT', level: 1, amount: 0, status: 'MISSED', reason: 'ACCOUNT_INACTIVE' }]);
    assert.equal((await rewardsOf(a.id))[0].status, 'PENDING');
  });

  it('same bank account as someone above them: the referral is rejected, nothing paid', async () => {
    const root = await agent('bank-root');
    const a = await agent('bank-a', root);
    for (const who of [root, a]) {
      await h.repo(E.AgentBankAccount).save({ agentId: who.id, accountNumber: '5010 0012 3456', ifscCode: 'HDFC0000001' } as never);
    }
    await qualify(a);
    assert.equal((await h.repo(E.AgentReferral).findOneByOrFail({ refereeAgentId: a.id })).status, 'REJECTED');
    assert.deepEqual(
      [...(await rewardsOf(root.id)), ...(await rewardsOf(a.id))].map((row) => [row.status, row.reason]),
      [['MISSED', 'SAME_BANK_ACCOUNT'], ['MISSED', 'SAME_BANK_ACCOUNT']],
    );
  });

  it('a referral that joined is honoured even after the program is switched off', async () => {
    const root = await agent('off-root');
    const a = await agent('off-a', root);
    await settings.set(SETTING_KEYS.REFERRAL_ENABLED, false);
    await qualify(a);
    assert.equal((await rewardsOf(root.id))[0].amount, 300);
  });

  it('completing the 5th job in the app triggers the rewards; plan visits count as jobs', async () => {
    const root = await agent('flow-root');
    const a = await agent('flow-a', root);

    const plan = await f.booking({ customerId, service, point: null, when: { date: todayString(), time: '08:00' }, status: 'accepted', agentId: a.id });
    for (const status of ['done', 'done', 'done', 'pending'] as const) {
      await h.repo(E.BookingVisit).save({ bookingId: plan.id, visitDate: todayString(), shift: 'morning', startTime: '08:00', otp: '1234', status } as never);
    }
    await doJobs(a, 1);
    assert.equal(await rewards.jobsDone(h.ds.manager, a.id), 4, '3 visits + 1 booking');

    const last = await f.booking({ customerId, service, point: null, when: { date: todayString(), time: '12:00' }, status: 'ongoing', agentId: a.id });
    await h.get(AgentBookingsService).complete(a.userId, last.id, {} as never);
    assert.deepEqual((await rewardsOf(root.id)).map((row) => row.amount), [300]);
  });

  it('salary: pending rewards up to the month end are added to net salary, and paid with it', async () => {
    const root = await agent('salary-root');
    const a = await agent('salary-a', root);
    await qualify(a);
    const b = await agent('salary-b', root);
    await qualify(b);
    // b's reward was earned after the month being paid, so it waits for next month's salary.
    const now = new Date();
    const later = new Date(now.getFullYear(), now.getMonth() + 1, 2);
    await h.repo(E.AgentReferralReward).update({ agentId: root.id, refereeAgentId: b.id }, { createdAt: later });

    const admin = await f.admin();
    const earnings = h.get(AdminEarningsService);
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    await asSuperAdmin(() => earnings.generateSalary(admin.id, { month, year } as never));

    const salary = await h.repo(E.SalaryRecord).findOneByOrFail({ agentId: root.id, month, year });
    assert.equal(Number(salary.referralBonus), 300);
    assert.equal(
      Number(salary.netSalary),
      Number(salary.fixedSalary) + Number(salary.incentive) + 300 - Number(salary.deductions),
    );
    const joining = await h.repo(E.SalaryRecord).findOneByOrFail({ agentId: a.id, month, year });
    assert.equal(Number(joining.referralBonus), 200, "the new agent's joining bonus is on their salary");

    const paid = await asSuperAdmin(() => earnings.updateSalary(admin.id, salary.id, { status: 'PAID' } as never));
    assert.equal(paid.referralBonus, 300);
    const rows = await h.repo(E.AgentReferralReward).find({ where: { agentId: root.id }, order: { createdAt: 'ASC' } });
    assert.deepEqual(rows.map((row) => [row.status, row.salaryRecordId]), [['PAID', salary.id], ['PENDING', null]]);

    // A rejected salary lets its rewards go to the next one.
    const other = await h.repo(E.SalaryRecord).findOneByOrFail({ agentId: a.id, month, year });
    await asSuperAdmin(() => earnings.updateSalary(admin.id, other.id, { status: 'REJECTED' } as never));
    const released = await h.repo(E.AgentReferralReward).findOneByOrFail({ agentId: a.id });
    assert.deepEqual([released.status, released.salaryRecordId], ['PENDING', null]);
    assert.equal(Number((await h.repo(E.SalaryRecord).findOneByOrFail({ id: other.id })).referralBonus), 0);
  });

  it('Refer & Earn: totals, team by level and history; deeper levels are not named', async () => {
    const root = await agent('screen-root');
    await doJobs(root, 12);
    const a = await agent('Ravi', root);
    await h.repo(E.Agent).update({ id: a.id }, { lastName: 'Sharma' });
    await qualify(a);
    const b = await agent('Suresh', a);
    await qualify(b);
    const c = await agent('Mohan', b);
    await qualify(c);

    const view = await h.get(AgentReferralsService).overview(root.userId);
    assert.deepEqual(view.earnings, { earned: 450, limit: 5000, paid: 0, pending: 450, missed: 0, missedCount: 0 });
    assert.deepEqual(view.activity, { jobsDone: 12, jobsRequired: 10, windowDays: 30, unlocked: true, applies: true });
    assert.deepEqual(
      view.levels.map((row) => [row.level, row.people, row.qualified, row.earned]),
      [[1, 1, 1, 300], [2, 1, 1, 100], [3, 1, 1, 50]],
    );
    assert.deepEqual(
      view.history.map((row) => [row.type, row.from, row.amount]),
      [['NETWORK', null, 50], ['NETWORK', null, 100], ['DIRECT', 'Ravi S.', 300]],
    );
    assert.equal(view.joiningBonus, null);

    const missedView = await h.get(AgentReferralsService).overview(a.userId);
    const missed = missedView.history.find((row) => row.status === 'MISSED')!;
    assert.equal(missed.reason, 'You had 5 of 10 jobs in the last 30 days');
    assert.equal(missedView.joiningBonus?.amount, 200);
    assert.equal(missedView.earnings.missed, 100);
  });
});
