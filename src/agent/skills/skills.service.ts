import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Agent, AgentSkill, Skill } from 'src/database/entities';
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
    const [agent, rows] = await Promise.all([
      this.agentRepo.findOne({ where: { id: agentId } }),
      this.agentSkillRepo.find({
        where: {
          agentId,
          selected: true,
          trainingStatus: In(['VERIFIED', 'IN_TRAINING']),
        },
        relations: ['skill'],
      }),
    ]);

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
    };
  }

  private async ensureCatalog() {
    const count = await this.skillRepo.count();
    if (count > 0) return;
    await this.skillRepo.save(
      SKILL_CATALOG.map((skill) =>
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
