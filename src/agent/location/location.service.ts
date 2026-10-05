import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent, AgentLocation, Booking } from 'src/database/entities';
import { ACTIVE_STATUSES } from 'src/common/booking/booking-status';
import { h3CellOf } from 'src/common/geo/geo.util';
import { AgentContextService } from '../shared/agent-context.service';
import { CreateAgentLocationDto } from './dto/create-location.dto';

/** Live tracking pings from the agent app while a job is in flight. */
@Injectable()
export class AgentLocationService {
  constructor(
    @InjectRepository(AgentLocation)
    private readonly locationRepo: Repository<AgentLocation>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    private readonly context: AgentContextService,
  ) {}

  async record(userId: string, dto: CreateAgentLocationDto) {
    const agent = await this.context.requireApprovedAgent(userId);

    if (dto.bookingId) {
      const booking = await this.bookingRepo.findOne({
        where: { id: dto.bookingId, agentId: agent.id },
        select: ['id', 'status'],
      });
      if (!booking) throw new NotFoundException('Booking not found');
      if (!ACTIVE_STATUSES.includes(booking.status)) {
        throw new BadRequestException('Booking is not active');
      }
    }

    const ping = await this.locationRepo.save(
      this.locationRepo.create({
        agentId: agent.id,
        bookingId: dto.bookingId ?? null,
        latitude: dto.latitude.toFixed(7),
        longitude: dto.longitude.toFixed(7),
      }),
    );

    agent.currentLocation = {
      latitude: dto.latitude,
      longitude: dto.longitude,
      recordedAt: ping.recordedAt.toISOString(),
    };
    agent.currentH3Cell = h3CellOf(dto.latitude, dto.longitude);
    await this.agentRepo.save(agent);

    return this.toResponse(ping);
  }

  async latest(userId: string) {
    const agent = await this.context.requireApprovedAgent(userId);
    if (agent.currentLocation) return { ...agent.currentLocation, source: 'current_location' };
    const ping = await this.locationRepo.findOne({
      where: { agentId: agent.id },
      order: { recordedAt: 'DESC' },
    });
    return ping ? this.toResponse(ping) : null;
  }

  private toResponse(ping: AgentLocation) {
    return {
      id: ping.id,
      bookingId: ping.bookingId,
      latitude: Number(ping.latitude),
      longitude: Number(ping.longitude),
      recordedAt: ping.recordedAt,
    };
  }
}
