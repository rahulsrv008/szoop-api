import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Agent, AgentSkill, Booking, Skill } from 'src/database/entities';
import { BATHROOM_SKILL_CODE, isBathroomJob } from 'src/dispatch/dispatch.rules';
import { AgentContextService } from '../shared/agent-context.service';
import {
  BOOSTED_SERVICE_RADIUS_KM,
  DEFAULT_SERVICE_RADIUS_KM,
  SKILL_CATALOG,
} from './skills.catalog';
import { SaveAgentSkillsDto, UpdateAgentBoostDto } from './dto/skills.dto';

@Injectable()
export class AgentSkillsService {
  constructor(
    @InjectRepository(Skill) private readonly skillRepo: Repository<Skill>,
    @InjectRepository(AgentSkill)
    private readonly agentSkillRepo: Repository<AgentSkill>,
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    private readonly context: AgentContextService,
  ) {}

  async list(userId: string) {
    const agent = await this.context.requireAgent(userId);
    await this.ensureCatalog();

    const [catalog, rows] = await Promise.all([
      this.skillRepo.find({ where: { isActive: true }, order: { name: 'ASC' } }),
      this.agentSkillRepo.find({
        where: { agentId: agent.id },
        relations: ['skill'],
      }),
    ]);

    const byCode = new Map(rows.map((row) => [row.skill.code, row]));

    return {
      boostEnabled: agent.boostEnabled,
      serviceRadiusKm: agent.boostEnabled
        ? BOOSTED_SERVICE_RADIUS_KM
        : DEFAULT_SERVICE_RADIUS_KM,
      catalog: catalog.map((skill) => this.toCatalog(skill)),
      skills: catalog.map((skill) => {
        const row = byCode.get(skill.code);
        return {
          skillId: skill.code,
          selected: row?.selected ?? false,
          trainingStatus: row?.trainingStatus ?? 'UNVERIFIED',
        };
      }),
    };
  }

  async save(userId: string, dto: SaveAgentSkillsDto) {
    const agent = await this.context.requireAgent(userId);
    await this.ensureCatalog();

    const codes = dto.skills.map((item) => item.skillId);
    const catalog = await this.skillRepo.find({ where: { code: In(codes) } });
    const byCode = new Map(catalog.map((skill) => [skill.code, skill]));

    for (const item of dto.skills) {
      const skill = byCode.get(item.skillId);
      if (!skill) throw new NotFoundException(`Unknown skill ${item.skillId}`);

      const existing = await this.agentSkillRepo.findOne({
        where: { agentId: agent.id, skillId: skill.id },
      });
      const row =
        existing ??
        this.agentSkillRepo.create({
          agentId: agent.id,
          skillId: skill.id,
        });
      row.selected = item.selected;
      if (item.trainingStatus) row.trainingStatus = item.trainingStatus;
      await this.agentSkillRepo.save(row);
    }

    return this.list(userId);
  }

  async setBoost(userId: string, dto: UpdateAgentBoostDto) {
    const agent = await this.context.requireAgent(userId);
    agent.boostEnabled = dto.enabled;
    await this.agentRepo.save(agent);
    return {
      boostEnabled: agent.boostEnabled,
      serviceRadiusKm: agent.boostEnabled
        ? BOOSTED_SERVICE_RADIUS_KM
        : DEFAULT_SERVICE_RADIUS_KM,
    };
  }

  async matchingContext(agentId: string) {
    const contexts = await this.matchingContexts([agentId]);
    return contexts.get(agentId) ?? toMatchingContext(null, []);
  }

  /** `matchingContext` for many agents in two queries — used by the dispatcher. */
  async matchingContexts(agentIds: string[]) {
    const ids = [...new Set(agentIds)];
    const contexts = new Map<string, ReturnType<typeof toMatchingContext>>();
    if (!ids.length) return contexts;

    const [agents, rows] = await Promise.all([
      this.agentRepo.find({ where: { id: In(ids) } }),
      this.agentSkillRepo.find({
        where: {
          agentId: In(ids),
          selected: true,
          trainingStatus: In(['VERIFIED', 'IN_TRAINING']),
        },
        relations: ['skill'],
      }),
    ]);
    for (const agent of agents) {
      contexts.set(
        agent.id,
        toMatchingContext(agent, rows.filter((row) => row.agentId === agent.id)),
      );
    }
    return contexts;
  }

  /**
   * Whether the agent may hold this booking. Only bathroom jobs are gated here:
   * they need the Bathroom Cleaning skill, whatever else the agent does.
   */
  async canTake(agentId: string, booking: Booking) {
    if (!isBathroomJob(booking)) return true;
    const { skillCodes } = await this.matchingContext(agentId);
    return skillCodes.includes(BATHROOM_SKILL_CODE);
  }

  /** Adds catalog skills the table doesn't have yet; existing rows are left as they are. */
  private async ensureCatalog() {
    const existing = await this.skillRepo.find({ select: ['code'] });
    const have = new Set(existing.map((skill) => skill.code));
    const missing = SKILL_CATALOG.filter((skill) => !have.has(skill.code));
    if (!missing.length) return;
    await this.skillRepo.save(
      missing.map((skill) =>
        this.skillRepo.create({
          code: skill.code,
          name: skill.name,
          category: skill.category,
          trainingTrack: skill.trainingTrack,
          description: skill.description,
          matchKeywords: skill.matchKeywords,
          isActive: true,
        }),
      ),
    );
  }

  private toCatalog(skill: Skill) {
    return {
      id: skill.code,
      name: skill.name,
      category: skill.category,
      trainingTrack: skill.trainingTrack,
      description: skill.description,
    };
  }
}

function toMatchingContext(agent: Agent | null, rows: AgentSkill[]) {
  return {
    boostEnabled: agent?.boostEnabled ?? false,
    serviceRadiusKm: agent?.boostEnabled
      ? BOOSTED_SERVICE_RADIUS_KM
      : DEFAULT_SERVICE_RADIUS_KM,
    keywords: rows.flatMap((row) =>
      [row.skill.name, row.skill.matchKeywords]
        .join(',')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
    skillCodes: rows.map((row) => row.skill.code),
  };
}
