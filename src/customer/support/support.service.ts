import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, SupportTicket } from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { CreateCustomerTicketDto } from './dto/create-ticket.dto';
import { ListCustomerTicketsQueryDto } from './dto/list-tickets.dto';

@Injectable()
export class CustomerSupportService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly identity: IdentityService,
  ) {}

  async create(userId: string, dto: CreateCustomerTicketDto) {
    const customerId = await this.identity.requireCustomerId(userId);

    if (dto.bookingId) {
      const booking = await this.bookingRepo.findOne({
        where: { id: dto.bookingId, customerId },
        select: ['id'],
      });
      if (!booking) throw new NotFoundException('Booking not found');
    }

    const ticket = await this.ticketRepo.save(
      this.ticketRepo.create({
        userId,
        app: 'customer',
        bookingId: dto.bookingId ?? null,
        subject: dto.subject,
        description: dto.description,
        priority: dto.priority ?? 'NORMAL',
        status: 'OPEN',
      }),
    );

    return this.toResponse(ticket);
  }

  async list(userId: string, query: ListCustomerTicketsQueryDto) {
    const [tickets, total] = await this.ticketRepo.findAndCount({
      where: { userId, ...(query.status ? { status: query.status } : {}) },
      relations: ['booking'],
      order: { createdAt: 'DESC' },
      ...skipTake(query),
    });

    return paginated(
      tickets.map((ticket) => this.toResponse(ticket)),
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
      status: ticket.status,
      priority: ticket.priority,
      bookingId: ticket.bookingId,
      bookingNumber: ticket.booking?.bookingNumber ?? null,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
  }
}
