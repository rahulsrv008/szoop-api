import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Agent, AgentBankAccount, AgentDocument } from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';
import { OtpService } from 'src/common/auth/otp.service';
import { TokenService } from 'src/common/auth/token.service';
import { AuthUser } from 'src/common/types/auth.types';
import {
  isRegistrationComplete,
  REQUIRED_DOCUMENT_TYPES,
  RegistrationSteps,
  resolveNextStep,
} from '../registration/registration.constants';

const PURPOSE = 'agent_login' as const;

@Injectable()
export class AgentAuthService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    @InjectRepository(AgentDocument)
    private readonly documentRepo: Repository<AgentDocument>,
    @InjectRepository(AgentBankAccount)
    private readonly bankRepo: Repository<AgentBankAccount>,
    private readonly otp: OtpService,
    private readonly identity: IdentityService,
    private readonly tokens: TokenService,
  ) {}

  sendOtp(mobile: string) {
    return this.otp.send(mobile, PURPOSE);
  }

  resendOtp(mobile: string) {
    return this.otp.send(mobile, PURPOSE, { isResend: true });
  }

  async verifyOtp(mobile: string, otp: string) {
    await this.otp.verify(mobile, otp, PURPOSE);

    const user = await this.identity.findOrCreateUser(mobile, 'agent');
    const agent = await this.identity.ensureAgent(user.id);
    const authUser = await this.identity.buildAuthUser(user.id, 'agent');
    const session = await this.tokens.issueSession(authUser);

    return {
      ...session,
      agent: await this.toSummary(mobile, agent),
    };
  }

  refresh(refreshToken: string) {
    return this.tokens.rotate(refreshToken, 'agent');
  }

  logout(user: AuthUser, refreshToken?: string) {
    return refreshToken
      ? this.tokens.revoke(refreshToken)
      : this.tokens.revokeAllForSubject(user);
  }

  async me(user: AuthUser) {
    const agent = await this.agentRepo.findOne({
      where: { userId: user.sub },
      relations: ['user'],
    });
    if (!agent) throw new NotFoundException('Agent profile not found');
    return this.toSummary(agent.user.mobile, agent);
  }

  /** Login response doubles as the "where do I resume onboarding" payload. */
  private async toSummary(mobile: string, agent: Agent) {
    const steps = await this.resolveSteps(agent.id, agent.firstName, agent.profileImage);

    return {
      agentId: agent.id,
      mobile,
      firstName: agent.firstName,
      status: agent.status,
      approvalStatus: agent.approvalStatus,
      isRegistrationComplete: isRegistrationComplete(steps),
      nextStep: resolveNextStep(steps, agent.approvalStatus),
    };
  }

  private async resolveSteps(
    agentId: string,
    firstName: string,
    profileImage: string | null,
  ): Promise<RegistrationSteps> {
    const [documentTypes, bankAccount] = await Promise.all([
      this.documentRepo.find({
        where: { agentId, documentType: In([...REQUIRED_DOCUMENT_TYPES]) },
        select: ['documentType'],
      }),
      this.bankRepo.findOne({ where: { agentId }, select: ['id'] }),
    ]);

    const uploaded = new Set(documentTypes.map((row) => row.documentType));

    return {
      personalDetails: !!firstName,
      documents: REQUIRED_DOCUMENT_TYPES.every((type) => uploaded.has(type)),
      profilePhoto: !!profileImage,
      bankDetails: !!bankAccount,
    };
  }
}
