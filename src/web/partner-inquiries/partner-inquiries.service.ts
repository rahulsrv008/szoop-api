import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminAccessService } from 'src/common/auth/admin-access';
import {
  PaginationQueryDto,
  paginated,
  skipTake,
} from 'src/common/dto/pagination.dto';
import { PartnerInquiry } from 'src/database/entities';
import { CreatePartnerInquiryDto } from './dto/create-partner-inquiry.dto';

@Injectable()
export class PartnerInquiriesService {
  constructor(
    @InjectRepository(PartnerInquiry)
    private readonly inquiryRepo: Repository<PartnerInquiry>,
    private readonly adminAccess: AdminAccessService,
  ) {}

  async create(dto: CreatePartnerInquiryDto) {
    return this.inquiryRepo.save(this.inquiryRepo.create(dto));
  }

  async list(query: PaginationQueryDto) {
    this.adminAccess.assertSuperAdmin();
    const { skip, take } = skipTake(query);
    const queryBuilder = this.inquiryRepo
      .createQueryBuilder('inquiry')
      .select([
        'inquiry.id',
        'inquiry.name',
        'inquiry.phone',
        'inquiry.email',
        'inquiry.city',
        'inquiry.partnerType',
        'inquiry.note',
        'inquiry.createdAt',
      ])
      .orderBy('inquiry.createdAt', 'DESC')
      .skip(skip)
      .take(take);

    const search = query.search?.trim();
    if (search) {
      queryBuilder.andWhere(
        `(
          inquiry.name ILIKE :search
          OR inquiry.phone ILIKE :search
          OR inquiry.email ILIKE :search
          OR inquiry.city ILIKE :search
          OR inquiry.partnerType ILIKE :search
        )`,
        { search: `%${search}%` },
      );
    }

    const [items, total] = await queryBuilder.getManyAndCount();
    return paginated(items, total, query);
  }
}
