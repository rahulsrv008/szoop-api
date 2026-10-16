import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, Rating, Review } from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';
import { NotificationDispatchService } from 'src/common/services/notification-dispatch.service';
import {
  PaginationQueryDto,
  paginated,
  skipTake,
} from 'src/common/dto/pagination.dto';
import { CreateCustomerRatingDto } from './dto/create-rating.dto';

@Injectable()
export class CustomerRatingsService {
  constructor(
    @InjectRepository(Rating)
    private readonly ratingRepo: Repository<Rating>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationDispatchService,
  ) {}

  async create(userId: string, dto: CreateCustomerRatingDto) {
    const customerId = await this.identity.requireCustomerId(userId);
    const booking = await this.bookingRepo.findOne({
      where: { id: dto.bookingId, customerId },
      relations: ['agent'],
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (booking.status !== 'completed') {
      throw new BadRequestException('Only completed bookings can be rated');
    }
    if (!booking.agent) {
      throw new BadRequestException('This booking has no agent to rate');
    }

    const existing = await this.ratingRepo.findOne({
      where: { bookingId: booking.id, customerId },
      select: ['id'],
    });
    if (existing) {
      throw new ConflictException('This booking has already been rated');
    }

    const rating = await this.ratingRepo.save(
      this.ratingRepo.create({
        bookingId: booking.id,
        customerId,
        agentId: booking.agent.id,
        rating: dto.rating.toFixed(1),
      }),
    );

    const reviewText = dto.review?.trim();
    if (reviewText) {
      await this.reviewRepo.save(
        this.reviewRepo.create({ ratingId: rating.id, reviewText }),
      );
    }

    await this.notifications.toUser(booking.agent.userId, {
      app: 'agent',
      title: 'New rating received',
      message: `You were rated ${dto.rating.toFixed(1)} for booking ${booking.bookingNumber}.`,
      type: 'rating',
      data: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
    });

    return {
      id: rating.id,
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      agentId: rating.agentId,
      rating: Number(rating.rating),
      review: reviewText ?? null,
      createdAt: rating.createdAt,
    };
  }

  async list(userId: string, query: PaginationQueryDto) {
    const customerId = await this.identity.requireCustomerId(userId);

    const [ratings, total] = await this.ratingRepo.findAndCount({
      where: { customerId },
      relations: ['booking', 'agent', 'reviews'],
      order: { createdAt: 'DESC' },
      ...skipTake(query),
    });

    const items = ratings.map((rating) => ({
      id: rating.id,
      bookingId: rating.bookingId,
      bookingNumber: rating.booking?.bookingNumber ?? null,
      agentId: rating.agentId,
      agentName: rating.agent
        ? [rating.agent.firstName, rating.agent.lastName]
            .filter(Boolean)
            .join(' ')
            .trim()
        : null,
      rating: Number(rating.rating),
      review: (rating.reviews ?? [])[0]?.reviewText ?? null,
      createdAt: rating.createdAt,
    }));

    return paginated(items, total, query);
  }
}
