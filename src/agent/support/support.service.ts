import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, SupportTicket } from 'src/database/entities';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { AgentContextService } from '../shared/agent-context.service';
import { CreateAgentSupportTicketDto } from './dto/create-ticket.dto';
import { ListAgentSupportTicketsDto } from './dto/list-tickets.dto';

@Injectable()
export class AgentSupportService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly context: AgentContextService,
  ) {}

  async create(userId: string, dto: CreateAgentSupportTicketDto) {
    const agent = await this.context.requireAgent(userId);

    if (dto.bookingId) {
      const booking = await this.bookingRepo.count({
        where: { id: dto.bookingId, agentId: agent.id },
      });
      if (!booking) throw new NotFoundException('Booking not found');
    }

    const ticket = await this.ticketRepo.save(
      this.ticketRepo.create({
        userId,
        app: 'agent',
        bookingId: dto.bookingId ?? null,
        subject: dto.subject,
        description: dto.description,
        priority: dto.priority ?? 'NORMAL',
        status: 'OPEN',
      }),
    );

    return this.toResponse(ticket);
  }

  async list(userId: string, query: ListAgentSupportTicketsDto) {
    const [rows, total] = await this.ticketRepo.findAndCount({
      where: { userId, ...(query.status ? { status: query.status } : {}) },
      relations: ['booking'],
      order: { createdAt: 'DESC' },
      ...skipTake(query),
    });

    return paginated(
      rows.map((row) => this.toResponse(row)),
      total,
      query,
    );
  }

  async detail(userId: string, id: string) {
    const ticket = await this.ticketRepo.findOne({
      where: { id, userId },
      relations: ['booking'],
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    return this.toResponse(ticket);
  }

  private toResponse(ticket: SupportTicket) {
    return {
      id: ticket.id,
      subject: ticket.subject,
      description: ticket.description,
      priority: ticket.priority,
      status: ticket.status,
      bookingId: ticket.bookingId,
      bookingNumber: ticket.booking?.bookingNumber ?? null,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
  }
}
