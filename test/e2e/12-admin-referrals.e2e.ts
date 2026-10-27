import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Factory, Harness, asSuperAdmin, rejectsWith, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { ReferralService } from 'src/common/referrals/referral.service';
import { ReferralRewardsService } from 'src/common/referrals/referral-rewards.service';
import { SETTING_KEYS, SettingsService } from 'src/common/services/settings.service';
import { AgentRegistrationService } from 'src/agent/registration/registration.service';
import { AdminReferralsService } from 'src/admin/referrals/referrals.service';
import { AdminEarningsService } from 'src/admin/earnings/earnings.service';
import { todayString } from 'src/agent/shared/date.util';

describe('Admin: referral settings, agent referrals and reversing rewards', () => {
  let h: Harness;
  let f: Factory;
  let admin: E.Admin;
  let customerId: string;
  let service: E.Service;
  let referralsAdmin: AdminReferralsService;

  const settings = {
    enabled: true,
    maxPerAgent: 3,
    maxLevels: 3,
    rewardTiers: [300, 500, 700],
    levelRewards: [100, 50],
    maxEarning: 5000,
    qualifyJobs: 5,
    joiningBonus: 200,
    activeMinJobs: 0,
    activeWindowDays: 30,
  };

  before(async () => {
    h = await startApp();
    f = new Factory(h);
    admin = await f.admin();
    await h.repo(E.Admin).update({ id: admin.id }, { firstName: 'Priya', lastName: 'Ops' });
    customerId = (await f.customer()).customer.id;
    service = await f.service('Cleaning');
    referralsAdmin = h.get(AdminReferralsService);
  });
  after(() => h.close());

  beforeEach(async () => {
    await asSuperAdmin(() => referralsAdmin.updateSettings(admin.id, settings as never));
  });

  const agent = async (name: string, referrer?: E.Agent) => {
    const created = await f.agent(name, { approvalStatus: 'PENDING', status: 'PENDING' });
    if (referrer) {
      await h.get(AgentRegistrationService).register(created.userId, { firstName: name, referralCode: referrer.employeeId! });
    }
    await h.repo(E.Agent).update({ id: created.id }, { approvalStatus: 'APPROVED', status: 'ACTIVE' });
    await h.get(ReferralService).assignEmployeeId(created.id);
    return h.repo(E.Agent).findOneByOrFail({ id: created.id });
  };
  const qualify = async (referee: E.Agent) => {
    for (let i = 0; i < 5; i += 1) {
      await f.booking({ customerId, service, point: null, when: { date: todayString(), time: '10:00' }, status: 'completed', agentId: referee.id });
    }
    await h.get(ReferralRewardsService).qualify(referee.id);
  };

  it('settings: saved from the admin panel, used at once, and who changed them is shown', async () => {
    const saved = await asSuperAdmin(() =>
      referralsAdmin.updateSettings(admin.id, { ...settings, maxLevels: 4, levelRewards: [100, 50, 25] } as never),
    );
    assert.deepEqual(saved.levelRewards, [100, 50, 25]);
    assert.equal(saved.lastChanged?.by, 'Priya Ops');
    assert.equal((await h.get(ReferralService).config()).maxLevels, 4);
    assert.equal(await h.get(SettingsService).get(SETTING_KEYS.REFERRAL_MAX_LEVELS, 0), 4);

    const audit = await h.repo(E.AuditLog).findOne({ where: { action: 'REFERRAL_SETTINGS_UPDATED' }, order: { createdAt: 'DESC' } });
    assert.deepEqual(audit?.newData, { maxLevels: 4, levelRewards: [100, 50, 25] }, 'only what changed is logged');
  });

  it('settings: one level 1 amount per invite, and one amount per deeper level', async () => {
    const tiers = await rejectsWith(
      asSuperAdmin(() => referralsAdmin.updateSettings(admin.id, { ...settings, maxPerAgent: 4 } as never)),
      400,
    );
    assert.match(tiers, /each of the 4 invites/);
    const levels = await rejectsWith(
      asSuperAdmin(() => referralsAdmin.updateSettings(admin.id, { ...settings, maxLevels: 2 } as never)),
      400,
    );
    assert.match(levels, /from 2 to 2/);
    await asSuperAdmin(() => referralsAdmin.updateSettings(admin.id, { ...settings, maxLevels: 1, levelRewards: [] } as never));
  });

  it("agent page: earnings by level, history with reasons, who referred them and their team", async () => {
    await asSuperAdmin(() => referralsAdmin.updateSettings(admin.id, { ...settings, maxEarning: 400 } as never));
    const root = await agent('Nitish');
    const amit = await agent('Amit', root);
    await qualify(amit);
    const ravi = await agent('Ravi', amit);
    await qualify(ravi);
    const sunil = await agent('Sunil', root);
    await qualify(sunil);

    const view = await asSuperAdmin(() => referralsAdmin.agentReferrals(root.id));
    assert.equal(view.employeeId, `${root.employeeId!.slice(0, 4)}-${root.employeeId!.slice(4)}`);
    assert.deepEqual(view.invites, { used: 2, max: 3, remaining: 1 });
    assert.deepEqual(view.totals, { earned: 400, limit: 400, paid: 0, pending: 400, missed: 500, missedCount: 1 });
    assert.deepEqual(
      view.levels.map((row) => [row.level, row.people, row.earned, row.missed]),
      [[1, 2, 300, 500], [2, 1, 100, 0], [3, 0, 0, 0]],
    );
    const missed = view.history.find((row) => row.from.name === 'Sunil')!;
    assert.deepEqual([missed.status, missed.reason], ['MISSED', 'Lifetime limit of ₹400 already reached']);
    const network = view.history.find((row) => row.type === 'NETWORK')!;
    assert.deepEqual(network.from, { agentId: ravi.id, name: 'Ravi', employeeId: `${ravi.employeeId!.slice(0, 4)}-${ravi.employeeId!.slice(4)}` }, 'admins see everyone named');
  });

  it('agent page: the team tree is nested and limited to the paid levels', async () => {
    const root = await agent('tree-root');
    const a = await agent('tree-a', root);
    const b = await agent('tree-b', a);
    const c = await agent('tree-c', b);
    await agent('tree-d', c);

    const view = await asSuperAdmin(() => referralsAdmin.agentReferrals(root.id));
    const names = (nodes: typeof view.team.members): unknown[] =>
      nodes.map((node) => [node.name, node.level, node.referralStatus, names(node.team)]);
    assert.deepEqual(names(view.team.members), [['tree-a', 1, 'JOINED', [['tree-b', 2, 'JOINED', [['tree-c', 3, 'JOINED', []]]]]]]);

    const child = await asSuperAdmin(() => referralsAdmin.agentReferrals(b.id));
    assert.deepEqual(child.referredBy?.name, 'tree-a');
  });

  it('reverse: a pending reward comes off a pending salary; not allowed on an approved one', async () => {
    const root = await agent('rev-root');
    const a = await agent('rev-a', root);
    await qualify(a);
    const b = await agent('rev-b', root);
    await qualify(b);

    const now = new Date();
    const earnings = h.get(AdminEarningsService);
    await asSuperAdmin(() => earnings.generateSalary(admin.id, { month: now.getMonth() + 1, year: now.getFullYear() } as never));
    const salary = await h.repo(E.SalaryRecord).findOneByOrFail({ agentId: root.id, month: now.getMonth() + 1, year: now.getFullYear() });
    assert.equal(Number(salary.referralBonus), 800);

    const [first, second] = await h.repo(E.AgentReferralReward).find({ where: { agentId: root.id }, order: { createdAt: 'ASC' } });
    const result = await asSuperAdmin(() => referralsAdmin.reverseReward(admin.id, first.id, { remarks: 'Duplicate account' }));
    assert.equal(result.wasPaid, false);
    const after = await h.repo(E.SalaryRecord).findOneByOrFail({ id: salary.id });
    assert.equal(Number(after.referralBonus), 500);
    assert.equal(Number(after.netSalary), Number(after.fixedSalary) + Number(after.incentive) + 500 - Number(after.deductions));

    const view = await asSuperAdmin(() => referralsAdmin.agentReferrals(root.id));
    const reversed = view.history.find((row) => row.id === first.id)!;
    assert.equal(reversed.status, 'REVERSED');
    assert.equal(reversed.reason, 'Reversed by Priya Ops: Duplicate account');
    assert.equal(reversed.canReverse, false);
    assert.equal(view.totals.earned, 500, 'a reversed reward no longer counts');

    await rejectsWith(asSuperAdmin(() => referralsAdmin.reverseReward(admin.id, first.id, { remarks: 'again' })), 400);

    await asSuperAdmin(() => earnings.updateSalary(admin.id, salary.id, { status: 'APPROVED' } as never));
    assert.equal((await asSuperAdmin(() => referralsAdmin.agentReferrals(root.id))).history.find((row) => row.id === second.id)?.canReverse, false);
    const blocked = await rejectsWith(asSuperAdmin(() => referralsAdmin.reverseReward(admin.id, second.id, { remarks: 'too late' })), 409);
    assert.match(blocked, /approved .* salary/);

    await asSuperAdmin(() => earnings.updateSalary(admin.id, salary.id, { status: 'PAID' } as never));
    const paid = await asSuperAdmin(() => referralsAdmin.reverseReward(admin.id, second.id, { remarks: 'Fake jobs' }));
    assert.equal(paid.wasPaid, true);
    assert.match(paid.message, /add it as a deduction/);
    const note = await h.repo(E.Notification).findOne({ where: { userId: root.userId, title: 'Referral reward taken back' }, order: { createdAt: 'DESC' } });
    assert.match(note!.message, /₹500 referral reward was taken back\. Fake jobs/);
  });
});
