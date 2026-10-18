import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Factory, Harness, area, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { AgentRegistrationService } from 'src/agent/registration/registration.service';

describe('Agent registration: where onboarding resumes', () => {
  let h: Harness;
  let f: Factory;
  let skill: E.Skill;

  before(async () => {
    h = await startApp();
    f = new Factory(h);
    skill = await f.skill('Cleaning', 'cleaning');
  });
  after(() => h.close());

  const status = (userId: string) => h.get(AgentRegistrationService).status(userId);
  const pendingWithDocs = async (name: string, index: number) => {
    const agent = await f.agent(name, { live: area(index), skills: [skill] });
    await h.repo(E.Agent).update({ id: agent.id }, { approvalStatus: 'PENDING', profileImage: null });
    await h.repo(E.AgentDocument).delete({ agentId: agent.id });
    await h.repo(E.AgentBankAccount).delete({ agentId: agent.id });
    for (const documentType of ['AADHAAR', 'PAN']) {
      await h.repo(E.AgentDocument).save({ agentId: agent.id, documentType, documentUrl: 'data:image/jpeg;base64,AA==' } as never);
    }
    return agent;
  };

  it('Aadhaar and PAN uploaded, no selfie: resumes at the selfie, not bank details', async () => {
    const agent = await pendingWithDocs('no-selfie', 1);
    const result = await status(agent.userId);
    assert.equal(result.nextStep, 'profile-photo');
    assert.equal(result.steps.profilePhoto, false);
    assert.ok(result.missing.includes('profilePhoto'));
    assert.equal(result.isRegistrationComplete, false);
  });

  it('with the selfie: on to bank details', async () => {
    const agent = await pendingWithDocs('with-selfie', 2);
    await h.repo(E.Agent).update({ id: agent.id }, { profileImage: 'data:image/jpeg;base64,AA==' });
    assert.equal((await status(agent.userId)).nextStep, 'bank-details');
  });

  it('only PAN uploaded: back to documents', async () => {
    const agent = await pendingWithDocs('one-doc', 3);
    await h.repo(E.AgentDocument).delete({ agentId: agent.id, documentType: 'AADHAAR' });
    assert.equal((await status(agent.userId)).nextStep, 'documents');
  });

  it('an agent approved before the selfie was checked is not sent back for one', async () => {
    const agent = await pendingWithDocs('approved-no-selfie', 4);
    await h.repo(E.Agent).update({ id: agent.id }, { approvalStatus: 'APPROVED' });
    assert.notEqual((await status(agent.userId)).nextStep, 'profile-photo');
  });
});
