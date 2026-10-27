import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin, Agent, Customer, User, UserType } from 'src/database/entities';
import { AuthUser } from '../types/auth.types';

/**
 * Single source of truth for turning a `users`/`admins` row into the
 * AuthUser shape carried inside access tokens.
 */
@Injectable()
export class IdentityService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(Admin) private readonly adminRepo: Repository<Admin>,
  ) { }

  async findOrCreateUser(mobile: string, role: UserType) {
    let user = await this.userRepo.findOne({ where: { mobile } });

    if (user?.deletedAt && role === 'customer') {
      user = await this.startFreshCustomer(user, mobile);
    } else if (!user) {
      user = await this.userRepo.save(
        this.userRepo.create({ mobile, userType: role, isActive: true }),
      );
    }

    if (!user.isActive) {
      throw new ForbiddenException(
        user.deletedAt
          ? 'This account has been deleted'
          : 'This account has been blocked',
      );
    }

    if (role === 'customer') await this.ensureCustomer(user.id);
    if (role === 'agent') await this.ensureAgent(user.id);

    return user;
  }

  /**
   * A deleted customer who signs in again becomes a new customer. The old row
   * stays for admin. If the same user is also an agent, the mobile cannot be
   * freed, so the customer profile is reset instead.
   */
  private async startFreshCustomer(existing: User, mobile: string) {
    const agent = await this.agentRepo.findOne({
      where: { userId: existing.id },
      select: ['id'],
    });

    if (agent) {
      existing.deletedAt = null;
      existing.isActive = true;
      await this.userRepo.save(existing);
      const customer = await this.ensureCustomer(existing.id);
      customer.firstName = null;
      customer.lastName = null;
      customer.profileImage = null;
      customer.gender = null;
      customer.dateOfBirth = null;
      await this.customerRepo.save(customer);
      return existing;
    }

    existing.mobile = `d${existing.id.replace(/-/g, '').slice(0, 14)}`;
    await this.userRepo.save(existing);

    return this.userRepo.save(
      this.userRepo.create({ mobile, userType: 'customer', isActive: true }),
    );
  }

  async ensureCustomer(userId: string) {
    const existing = await this.customerRepo.findOne({ where: { userId } });
    if (existing) return existing;
    return this.customerRepo.save(this.customerRepo.create({ userId }));
  }

  async ensureAgent(userId: string) {
    const existing = await this.agentRepo.findOne({ where: { userId } });
    if (existing) return existing;
    return this.agentRepo.save(
      this.agentRepo.create({
        userId,
        firstName: '',
        status: 'PENDING',
        approvalStatus: 'PENDING',
      }),
    );
  }

  /** Builds the token payload for a customer/agent user. */
  async buildAuthUser(userId: string, role: 'customer' | 'agent'): Promise<AuthUser> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['customer', 'agent'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isActive) {
      throw new ForbiddenException(
        user.deletedAt
          ? 'This account has been deleted'
          : 'This account has been blocked',
      );
    }

    return {
      sub: user.id,
      role,
      phone: user.mobile,
      email: user.email ?? undefined,
      customerId: user.customer?.id,
      agentId: user.agent?.id,
    };
  }

  async buildAdminAuthUser(adminId: string): Promise<AuthUser> {
    const admin = await this.adminRepo.findOne({ where: { id: adminId } });
    if (!admin) throw new NotFoundException('Admin not found');
    if (!admin.isActive) {
      throw new ForbiddenException('This admin account is disabled');
    }

    return {
      sub: admin.id,
      role: 'admin',
      email: admin.email,
      adminId: admin.id,
    };
  }

  /** Called on every authenticated request so blocks take effect immediately. */
  async assertActive(user: AuthUser) {
    if (user.role === 'admin') {
      const admin = await this.adminRepo.findOne({
        where: { id: user.sub },
        select: ['id', 'isActive'],
      });
      if (!admin?.isActive) {
        throw new ForbiddenException('This admin account is disabled');
      }
      return;
    }

    const row = await this.userRepo.findOne({
      where: { id: user.sub },
      select: ['id', 'isActive', 'deletedAt'],
    });
    if (!row?.isActive) {
      throw new ForbiddenException(
        row?.deletedAt
          ? 'This account has been deleted'
          : 'This account has been blocked',
      );
    }
  }

  async requireCustomerId(userId: string) {
    const customer = await this.customerRepo.findOne({
      where: { userId },
      select: ['id'],
    });
    if (!customer) throw new NotFoundException('Customer profile not found');
    return customer.id;
  }

  async requireAgentId(userId: string) {
    const agent = await this.agentRepo.findOne({
      where: { userId },
      select: ['id'],
    });
    if (!agent) throw new NotFoundException('Agent profile not found');
    return agent.id;
  }

  async requireAgent(userId: string) {
    const agent = await this.agentRepo.findOne({ where: { userId } });
    if (!agent) throw new NotFoundException('Agent profile not found');
    return agent;
  }

  async requireCustomer(userId: string) {
    const customer = await this.customerRepo.findOne({
      where: { userId },
      relations: ['user'],
    });
    if (!customer) throw new NotFoundException('Customer profile not found');
    return customer;
  }
}
