import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Customer, User } from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';
import { UpdateCustomerProfileDto } from './dto/update-profile.dto';

@Injectable()
export class CustomerProfileService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly identity: IdentityService,
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
