import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent, AgentBankAccount, AgentDocument } from 'src/database/entities';
import { AgentContextService } from '../shared/agent-context.service';
import { ZoneResolverService } from 'src/common/services/zone-resolver.service';
import { h3CellOf } from 'src/common/geo/geo.util';
import { CreateAgentRegistrationDto } from './dto/create-registration.dto';
import { UpdateAgentPersonalDetailsDto } from './dto/update-personal-details.dto';
import { SaveAgentAddressDto } from './dto/save-address.dto';
import {
  isRegistrationComplete,
  missingSteps,
  REQUIRED_DOCUMENT_TYPES,
  RegistrationSteps,
  resolveNextStep,
} from './registration.constants';

@Injectable()
export class AgentRegistrationService {
  constructor(
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(AgentDocument)
    private readonly documentRepo: Repository<AgentDocument>,
    @InjectRepository(AgentBankAccount)
    private readonly bankRepo: Repository<AgentBankAccount>,
    private readonly context: AgentContextService,
    private readonly zones: ZoneResolverService,
  ) {}

  async register(userId: string, dto: CreateAgentRegistrationDto) {
    const agent = await this.context.requireAgent(userId);
    this.assertEditable(agent);

    agent.firstName = dto.firstName;
    if (dto.lastName !== undefined) agent.lastName = dto.lastName;
    if (dto.gender !== undefined) agent.gender = dto.gender;
    if (dto.dateOfBirth !== undefined) agent.dateOfBirth = dto.dateOfBirth;
    if (dto.profileImage !== undefined) agent.profileImage = dto.profileImage;

    await this.agentRepo.save(agent);
    return this.status(userId);
  }

  async updatePersonalDetails(
    userId: string,
    dto: UpdateAgentPersonalDetailsDto,
  ) {
    const agent = await this.context.requireAgent(userId);
    this.assertEditable(agent);

    if (dto.firstName !== undefined) agent.firstName = dto.firstName;
    if (dto.lastName !== undefined) agent.lastName = dto.lastName;
    if (dto.gender !== undefined) agent.gender = dto.gender;
    if (dto.dateOfBirth !== undefined) agent.dateOfBirth = dto.dateOfBirth;
    if (dto.profileImage !== undefined) agent.profileImage = dto.profileImage;

    await this.agentRepo.save(agent);
    return this.status(userId);
  }

  async saveAddress(userId: string, dto: SaveAgentAddressDto) {
    const agent = await this.context.requireAgent(userId);
    this.assertEditable(agent);

    agent.addressLine1 = dto.addressLine1;
    agent.locality = dto.locality ?? null;
    agent.city = dto.city;
    agent.state = dto.state ?? null;
    agent.pincode = dto.pincode ?? null;
    agent.latitude =
      dto.latitude === undefined ? agent.latitude : dto.latitude.toFixed(7);
    agent.longitude =
      dto.longitude === undefined ? agent.longitude : dto.longitude.toFixed(7);

    const zone = await this.zones.resolve({
      pincode: agent.pincode,
      latitude: agent.latitude == null ? null : Number(agent.latitude),
      longitude: agent.longitude == null ? null : Number(agent.longitude),
      city: agent.city,
    });
    agent.homeZoneId = zone?.id ?? null;
    agent.homeH3Cell = h3CellOf(agent.latitude, agent.longitude);
    if (agent.latitude != null && agent.longitude != null) {
      agent.currentLocation = {
        latitude: Number(agent.latitude),
        longitude: Number(agent.longitude),
        recordedAt: new Date().toISOString(),
      };
      agent.currentH3Cell = h3CellOf(agent.latitude, agent.longitude);
    }

    await this.agentRepo.save(agent);
    return this.status(userId);
  }

  async status(userId: string) {
    const agent = await this.context.requireAgent(userId);

    const [documents, bankAccount] = await Promise.all([
      this.documentRepo.find({
        where: { agentId: agent.id },
        order: { createdAt: 'DESC' },
      }),
      this.bankRepo.findOne({ where: { agentId: agent.id }, select: ['id'] }),
    ]);

    const uploaded = new Set(documents.map((row) => row.documentType));
    const steps: RegistrationSteps = {
      personalDetails: !!agent.firstName,
      documents: REQUIRED_DOCUMENT_TYPES.every((type) => uploaded.has(type)),
      profilePhoto: !!agent.profileImage,
      bankDetails: !!bankAccount,
    };

    return {
      status: agent.status,
      approvalStatus: agent.approvalStatus,
      joiningDate: agent.joiningDate,
      steps,
      missing: missingSteps(steps),
      nextStep: resolveNextStep(steps, agent.approvalStatus),
      isRegistrationComplete: isRegistrationComplete(steps),
      requiredDocumentTypes: [...REQUIRED_DOCUMENT_TYPES],
      address: {
        addressLine1: agent.addressLine1,
        locality: agent.locality,
        city: agent.city,
        state: agent.state,
        pincode: agent.pincode,
        latitude: agent.latitude === null ? null : Number(agent.latitude),
        longitude: agent.longitude === null ? null : Number(agent.longitude),
      },
      homeZone: await this.zones.summaryById(agent.homeZoneId),
      serviceAreas: await this.zones.listSummaries(agent.serviceAreas ?? []),
      currentLocation: agent.currentLocation,
      documents: documents.map((document) => ({
        documentType: document.documentType,
        verificationStatus: document.verificationStatus,
      })),
    };
  }

  /** Once admin has approved the agent, onboarding data is frozen. */
  private assertEditable(agent: Agent) {
    if (agent.approvalStatus === 'APPROVED') {
      throw new ConflictException(
        'Registration is already approved — use the profile screen to make changes',
      );
    }
  }
}
