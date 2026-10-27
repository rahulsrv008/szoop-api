import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Customer, SupportTicket, User } from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';
import { TokenService } from 'src/common/auth/token.service';
import { UpdateCustomerProfileDto } from './dto/update-profile.dto';
import { RequestAccountDeletionDto } from './dto/request-account-deletion.dto';

@Injectable()
export class CustomerProfileService {
  private readonly logger = new Logger(CustomerProfileService.name);

  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    private readonly identity: IdentityService,
    private readonly tokens: TokenService,
  ) {}

  async get(userId: string) {
    const customer = await this.identity.requireCustomer(userId);
    return this.toResponse(customer);
  }

  async update(userId: string, dto: UpdateCustomerProfileDto) {
    const customer = await this.identity.requireCustomer(userId);

    if (dto.email !== undefined && dto.email !== customer.user.email) {
      const taken = await this.userRepo.findOne({
        where: { email: dto.email, id: Not(userId) },
        select: ['id'],
      });
      if (taken) throw new ConflictException('Email already in use');
      customer.user.email = dto.email;
      await this.userRepo.save(customer.user);
    }

    if (dto.firstName !== undefined) customer.firstName = dto.firstName;
    if (dto.lastName !== undefined) customer.lastName = dto.lastName;
    if (dto.gender !== undefined) customer.gender = dto.gender;
    if (dto.dateOfBirth !== undefined) customer.dateOfBirth = dto.dateOfBirth;
    if (dto.profileImage !== undefined)
      customer.profileImage = dto.profileImage ? dto.profileImage : null;

    await this.customerRepo.save(customer);
    return this.toResponse(customer);
  }

  /**
   * Public web form. Records a ticket and blocks the customer if found.
   * Data is left intact for admin to remove later.
   */
  async requestDeletion(dto: RequestAccountDeletionDto) {
    const user = await this.userRepo.findOne({
      where: { mobile: dto.mobile, userType: 'customer' },
    });
    if (user) {
      await this.blockWithDeletionRequest(user, 'web', dto);
    }

    this.logger.log(`Szoop account-deletion request recorded for ${dto.mobile}`);
    return {
      received: true,
      message:
        'If a Szoop customer account exists for this number, it is marked deleted. Signing in again starts a new customer.',
    };
  }

  async deleteAccount(userId: string) {
    const customer = await this.identity.requireCustomer(userId);
    await this.blockWithDeletionRequest(customer.user, 'app');
    return { requested: true, deleted: true };
  }

  private async blockWithDeletionRequest(
    user: User,
    source: 'app' | 'web',
    extra?: Pick<RequestAccountDeletionDto, 'name' | 'email' | 'note'>,
  ) {
    const open = await this.ticketRepo.findOne({
      where: {
        userId: user.id,
        subject: 'Szoop account deletion request',
        status: 'OPEN',
      },
      select: ['id'],
    });
    if (!open) {
      await this.ticketRepo.save(
        this.ticketRepo.create({
          userId: user.id,
          app: 'customer',
          subject: 'Szoop account deletion request',
          description: [
            `${source === 'app' ? 'In-app' : 'Web'} deletion request for Szoop customer ${user.mobile}.`,
            'Account marked deleted. Data kept for admin. A later login on this number starts a new customer.',
            extra?.name ? `Name: ${extra.name}` : null,
            extra?.email ? `Email: ${extra.email}` : null,
            extra?.note ? `Note: ${extra.note}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
          priority: 'HIGH',
          status: 'OPEN',
        }),
      );
    }

    if (user.isActive || !user.deletedAt) {
      user.isActive = false;
      user.deletedAt = user.deletedAt ?? new Date();
      await this.userRepo.save(user);
      await this.tokens.revokeAllForSubject({
        sub: user.id,
        role: 'customer',
        phone: user.mobile,
      });
    }
  }

  private toResponse(customer: Customer) {
    return {
      customerId: customer.id,
      userId: customer.userId,
      mobile: customer.user.mobile,
      email: customer.user.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      profileImage: customer.profileImage,
      gender: customer.gender,
      dateOfBirth: customer.dateOfBirth,
      isProfileComplete: !!customer.firstName,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }
}
