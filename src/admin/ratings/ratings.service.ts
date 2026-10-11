import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Rating, Review } from 'src/database/entities';
import { AdminAccessService } from 'src/common/auth/admin-access';
import { AuditService } from 'src/common/services/audit.service';
import { paginated, skipTake } from 'src/common/dto/pagination.dto';
import { ListAdminRatingsDto } from './dto/list-ratings.dto';

interface RatingListRow {
  id: string;
  rating: string;
  reviewText: string | null;
  bookingId: string;
  bookingNumber: string;
  customerId: string;
  customerFirstName: string | null;
  customerLastName: string | null;
  agentId: string;
  agentFirstName: string;
  agentLastName: string | null;
  createdAt: Date;
}

@Injectable()
export class AdminRatingsService {
  constructor(
    @InjectRepository(Rating) private readonly ratingRepo: Repository<Rating>,
    @InjectRepository(Review) private readonly reviewRepo: Repository<Review>,
    private readonly audit: AuditService,
    private readonly access: AdminAccessService,
  ) {}

  async list(query: ListAdminRatingsDto) {
    const { skip, take } = skipTake(query);

    const rowsQb = this.applyFilters(this.baseQuery(), query)
      .select('rating.id', 'id')
      .addSelect('rating.rating', 'rating')
      .addSelect('rating.bookingId', 'bookingId')
      .addSelect('booking.bookingNumber', 'bookingNumber')
      .addSelect('rating.customerId', 'customerId')
      .addSelect('customer.firstName', 'customerFirstName')
      .addSelect('customer.lastName', 'customerLastName')
      .addSelect('rating.agentId', 'agentId')
      .addSelect('agent.firstName', 'agentFirstName')
      .addSelect('agent.lastName', 'agentLastName')
      .addSelect('rating.createdAt', 'createdAt')
      .addSelect(
        `(SELECT rv.review_text FROM reviews rv
           WHERE rv.rating_id = rating.id
           ORDER BY rv.created_at ASC LIMIT 1)`,
        'reviewText',
      )
      .orderBy('rating.createdAt', 'DESC')
      .offset(skip)
      .limit(take);

    const summaryQb = this.applyFilters(this.baseQuery(), query)
      .select('COALESCE(AVG(rating.rating), 0)', 'average')
      .addSelect('COUNT(*)::int', 'count');

    const breakdownQb = this.applyFilters(this.baseQuery(), query)
      .select('ROUND(rating.rating)::int', 'star')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('ROUND(rating.rating)');

    const [rows, total, summary, breakdownRows] = await Promise.all([
      rowsQb.getRawMany<RatingListRow>(),
      this.applyFilters(this.baseQuery(), query).getCount(),
      summaryQb.getRawOne<{ average: string; count: number }>(),
      breakdownQb.getRawMany<{ star: number; count: number }>(),
    ]);

    const breakdown = [1, 2, 3, 4, 5].reduce<Record<string, number>>(
      (acc, star) => {
        const match = breakdownRows.find((row) => Number(row.star) === star);
        acc[String(star)] = Number(match?.count ?? 0);
        return acc;
      },
      {},
    );

    const page = paginated(
      rows.map((row) => ({
        id: row.id,
        rating: Number(row.rating),
        reviewText: row.reviewText,
        bookingId: row.bookingId,
        bookingNumber: row.bookingNumber,
        customerId: row.customerId,
        customerName: this.fullName(
          row.customerFirstName,
          row.customerLastName,
        ),
        agentId: row.agentId,
        agentName: this.fullName(row.agentFirstName, row.agentLastName),
        createdAt: row.createdAt,
      })),
      total,
      query,
    );

    return {
      ...page,
      summary: {
        average: Number(Number(summary?.average ?? 0).toFixed(2)),
        count: Number(summary?.count ?? 0),
        breakdown,
      },
    };
  }

  async detail(id: string) {
    const rating = await this.ratingRepo.findOne({
      where: { id },
      relations: [
        'booking',
        'customer',
        'customer.user',
        'agent',
        'agent.user',
        'reviews',
      ],
    });
    if (!rating) throw new NotFoundException('Rating not found');
    this.access.assertZone(rating.booking?.serviceAreaId, 'Rating');

    return {
      id: rating.id,
      rating: Number(rating.rating),
      createdAt: rating.createdAt,
      booking: rating.booking
        ? {
            id: rating.booking.id,
            bookingNumber: rating.booking.bookingNumber,
            bookingDate: rating.booking.bookingDate,
            status: rating.booking.status,
          }
        : null,
      customer: rating.customer
        ? {
            customerId: rating.customer.id,
            name: this.fullName(
              rating.customer.firstName,
              rating.customer.lastName,
            ),
            mobile: rating.customer.user?.mobile ?? null,
          }
        : null,
      agent: rating.agent
        ? {
            agentId: rating.agent.id,
            name: this.fullName(rating.agent.firstName, rating.agent.lastName),
            mobile: rating.agent.user?.mobile ?? null,
          }
        : null,
      reviews: (rating.reviews ?? [])
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((review) => ({
          id: review.id,
          reviewText: review.reviewText,
          createdAt: review.createdAt,
        })),
    };
  }

  /** Moderation: reviews go first because they point at the rating row. */
  async remove(adminId: string, id: string) {
    const rating = await this.ratingRepo.findOne({
      where: { id },
      relations: ['reviews', 'booking'],
    });
    if (!rating) throw new NotFoundException('Rating not found');
    this.access.assertZone(rating.booking?.serviceAreaId, 'Rating');

    const oldData = {
      bookingId: rating.bookingId,
      customerId: rating.customerId,
      agentId: rating.agentId,
      rating: rating.rating,
      createdAt: rating.createdAt,
      reviews: (rating.reviews ?? []).map((review) => ({
        id: review.id,
        reviewText: review.reviewText,
      })),
    };

    await this.reviewRepo.delete({ ratingId: id });
    await this.ratingRepo.delete({ id });

    await this.audit.record({
      userId: adminId,
      action: 'RATING_DELETED',
      entityType: 'ratings',
      entityId: id,
      oldData,
      newData: null,
    });

    return {
      deleted: true,
      reviewsDeleted: (rating.reviews ?? []).length,
    };
  }

  private baseQuery() {
    return this.ratingRepo
      .createQueryBuilder('rating')
      .innerJoin('rating.booking', 'booking')
      .innerJoin('rating.customer', 'customer')
      .innerJoin('rating.agent', 'agent');
  }

  private applyFilters(
    qb: SelectQueryBuilder<Rating>,
    query: ListAdminRatingsDto,
  ) {
    if (query.search) {
      qb.andWhere('booking.bookingNumber ILIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }
    if (query.agentId) {
      qb.andWhere('rating.agentId = :agentId', { agentId: query.agentId });
    }
    if (query.customerId) {
      qb.andWhere('rating.customerId = :customerId', {
        customerId: query.customerId,
      });
    }
    if (query.minRating !== undefined) {
      qb.andWhere('rating.rating >= :minRating', {
        minRating: query.minRating,
      });
    }
    if (query.maxRating !== undefined) {
      qb.andWhere('rating.rating <= :maxRating', {
        maxRating: query.maxRating,
      });
    }
    if (query.from) {
      qb.andWhere('rating.createdAt >= :from', {
        from: new Date(`${query.from}T00:00:00.000Z`),
      });
    }
    if (query.to) {
      qb.andWhere('rating.createdAt <= :to', {
        to: new Date(`${query.to}T23:59:59.999Z`),
      });
    }
    this.access.restrictZoneColumn(qb, 'booking.service_area_id');
    return qb;
  }

  private fullName(firstName: string | null, lastName: string | null) {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  }
}
