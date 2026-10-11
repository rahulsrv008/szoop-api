import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';
import { OtpService } from 'src/common/auth/otp.service';
import { TokenService } from 'src/common/auth/token.service';
import { AuthUser } from 'src/common/types/auth.types';
import type { OtpDeliveryChannel } from 'src/common/types/otp.types';

const PURPOSE = 'customer_login' as const;

@Injectable()
export class CustomerAuthService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly otp: OtpService,
    private readonly identity: IdentityService,
    private readonly tokens: TokenService,
  ) {}

  sendOtp(mobile: string, channel?: OtpDeliveryChannel) {
    return this.otp.send(mobile, PURPOSE, { channel });
  }

  resendOtp(mobile: string, channel?: OtpDeliveryChannel) {
    return this.otp.send(mobile, PURPOSE, { isResend: true, channel });
  }

  async verifyOtp(mobile: string, otp: string) {
    await this.otp.verify(mobile, otp, PURPOSE);

    const user = await this.identity.findOrCreateUser(mobile, 'customer');
    const customer = await this.identity.ensureCustomer(user.id);
    const authUser = await this.identity.buildAuthUser(user.id, 'customer');
    const session = await this.tokens.issueSession(authUser);

    return {
      ...session,
      isProfileComplete: !!customer.firstName,
      customer: this.toProfile(user.id, mobile, user.email, customer),
    };
  }

  refresh(refreshToken: string) {
    return this.tokens.rotate(refreshToken, 'customer');
  }

  logout(user: AuthUser, refreshToken?: string) {
    return refreshToken
      ? this.tokens.revoke(refreshToken)
      : this.tokens.revokeAllForSubject(user);
  }

  async me(user: AuthUser) {
    const customer = await this.identity.requireCustomer(user.sub);
    return this.toProfile(
      user.sub,
      customer.user.mobile,
      customer.user.email,
      customer,
    );
  }

  private toProfile(
    userId: string,
    mobile: string,
    email: string | null,
    customer: Customer,
  ) {
    return {
      userId,
      customerId: customer.id,
      mobile,
      email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      profileImage: customer.profileImage,
      gender: customer.gender,
      dateOfBirth: customer.dateOfBirth,
      createdAt: customer.createdAt,
    };
  }
}
