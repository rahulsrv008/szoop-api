import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { AgentAvailability, Booking } from 'src/database/entities';
import { DateRangeQueryDto } from 'src/common/dto/date-range.dto';
import { AgentContextService } from '../shared/agent-context.service';
import { EligibilityService } from 'src/dispatch/eligibility.service';
import { toMinutes } from 'src/dispatch/dispatch.rules';
import { resolveDateRange, todayString } from '../shared/date.util';
import { UpdateAgentAvailabilityDto } from './dto/update-availability.dto';

@Injectable()
export class AgentAvailabilityService {
  constructor(
    @InjectRepository(AgentAvailability)
    private readonly availabilityRepo: Repository<AgentAvailability>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly context: AgentContextService,
    private readonly eligibility: EligibilityService,
  ) {}

  async update(userId: string, dto: UpdateAgentAvailabilityDto) {
    const agent = await this.context.requireApprovedAgent(userId);
    const availabilityDate = dto.availabilityDate ?? todayString();

    if (!dto.isAvailable) {
      const ongoing = await this.bookingRepo.count({
        where: { agentId: agent.id, status: 'ongoing' },
      });
      if (ongoing > 0) {
        throw new BadRequestException(
          'Finish your ongoing job before going offline',
        );
      }
    }

    await this.assertKeepsHeldJobs(agent.id, availabilityDate, dto);

    // No unique index on (agent_id, availability_date), so upsert by hand.
    const existing = await this.availabilityRepo.findOne({
      where: { agentId: agent.id, availabilityDate },
    });
    const row =
      existing ??
      this.availabilityRepo.create({ agentId: agent.id, availabilityDate });

    row.isAvailable = dto.isAvailable;
    if (dto.startTime !== undefined) row.startTime = dto.startTime;
    if (dto.endTime !== undefined) row.endTime = dto.endTime;

    return this.toResponse(await this.availabilityRepo.save(row));
  }

  async list(userId: string, query: DateRangeQueryDto) {
    const agent = await this.context.requireApprovedAgent(userId);
    const { from, to } = resolveDateRange(query);
    const today = todayString();

    const rows = await this.availabilityRepo.find({
      where: { agentId: agent.id, availabilityDate: Between(from, to) },
      order: { availabilityDate: 'ASC' },
    });

    const todayRow = await this.availabilityRepo.findOne({
      where: { agentId: agent.id, availabilityDate: today },
    });

    return {
      from,
      to,
      isOnlineToday: todayRow?.isAvailable ?? false,
      items: rows.map((row) => this.toResponse(row)),
    };
  }

  /**
   * Going offline (or narrowing the hours) on a day can't strand jobs the
   * agent already holds that day: they must release those first.
   */
  private async assertKeepsHeldJobs(
    agentId: string,
    date: string,
    dto: UpdateAgentAvailabilityDto,
  ) {
    const held = await this.eligibility.committedSlotsOn(agentId, date);
    const from = dto.startTime ? toMinutes(dto.startTime) : null;
    const until = dto.endTime ? toMinutes(dto.endTime) : null;
    const stranded = held.filter(({ slots }) =>
      slots.some(
        (slot) =>
          !dto.isAvailable ||
          (from !== null && slot.start < from) ||
          (until !== null && slot.end > until),
      ),
    );
    if (stranded.length) {
      const numbers = stranded.map(({ booking }) => booking.bookingNumber).join(', ');
      throw new BadRequestException(
        `You have jobs at that time (${numbers}). Release them before changing your availability.`,
      );
    }
  }

  private toResponse(row: AgentAvailability) {
    return {
      id: row.id,
      availabilityDate: row.availabilityDate,
      startTime: row.startTime,
      endTime: row.endTime,
      isAvailable: row.isAvailable,
    };
  }
}
