import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { OtpVerification } from 'src/database/entities';
import { CustomLoggerService } from 'src/common/utils/logger.service';
import { SmsService } from 'src/integrations/sms/sms.service';

export type OtpPurpose = 'customer_login' | 'agent_login';

export interface OtpChallenge {
  mobile: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  demoMode: boolean;
  /** Only populated while OTP_DEMO_MODE=true so QA can log in without SMS. */
  demoOtp?: string;
}

function hashOtp(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

@Injectable()
export class OtpService {
  constructor(
    @InjectRepository(OtpVerification)
    private readonly otpRepo: Repository<OtpVerification>,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly logger: CustomLoggerService,
  ) {}

  async send(
    mobile: string,
    purpose: OtpPurpose,
    options: { isResend?: boolean } = {},
  ): Promise<OtpChallenge> {
    const ttl = this.ttlSeconds();
    const resendInterval = this.resendIntervalSeconds();
    const demoMode = this.demoMode();

    const active = await this.otpRepo.findOne({
      where: { mobile, purpose, verifiedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
    });

    if (active) {
      const sinceLast = (Date.now() - active.createdAt.getTime()) / 1000;
      if (sinceLast < resendInterval) {
        throw new BadRequestException(
          `Please wait ${Math.ceil(resendInterval - sinceLast)}s before requesting another OTP`,
        );
      }
      // A fresh code invalidates the previous one.
      active.expiresAt = new Date();
      await this.otpRepo.save(active);
    }

    if (options.isResend && !active) {
      throw new BadRequestException('No OTP to resend — request a new one');
    }

    const useTwilio = !demoMode && this.sms.usesTwilioVerify();
    const code = this.generateCode(demoMode);
    await this.otpRepo.save(
      this.otpRepo.create({
        mobile,
        otpHash: hashOtp(useTwilio ? '__twilio_verify__' : code),
        purpose,
        attempts: 0,
        expiresAt: new Date(Date.now() + ttl * 1000),
        verifiedAt: null,
      }),
    );

    if (demoMode) {
      this.logger.log(`[otp:demo] ${purpose} ${mobile} code=${code}`, 'OtpService');
    } else {
      const sms = useTwilio
        ? await this.sms.sendOtp(mobile, '')
        : await this.sms.sendOtp(mobile, code);
      if (!sms.delivered) {
        throw new InternalServerErrorException(
          sms.error || 'Could not send OTP SMS. Try again in a moment.',
        );
      }
    }

    return {
      mobile,
      expiresInSeconds: ttl,
      resendAfterSeconds: resendInterval,
      demoMode,
      ...(demoMode ? { demoOtp: code } : {}),
    };
  }

  async verify(mobile: string, code: string, purpose: OtpPurpose) {
    const session = await this.otpRepo.findOne({
      where: { mobile, purpose, verifiedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!session) {
      throw new UnauthorizedException('No OTP requested for this mobile number');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('OTP expired — request a new one');
    }

    const maxAttempts = this.maxAttempts();
    if (session.attempts >= maxAttempts) {
      throw new UnauthorizedException('Too many wrong attempts — request a new OTP');
    }

    session.attempts += 1;
    const twilioSent = session.otpHash === hashOtp('__twilio_verify__');
    const localMatch = session.otpHash === hashOtp(code);
    if (twilioSent || (!localMatch && this.sms.usesTwilioVerify())) {
      const check = await this.sms.checkTwilioOtp(mobile, code);
      if (!check.ok && !localMatch) {
        await this.otpRepo.save(session);
        const left = Math.max(maxAttempts - session.attempts, 0);
        throw new UnauthorizedException(
          `${'error' in check ? check.error : 'Invalid OTP'} — ${left} attempt(s) left`,
        );
      }
    } else if (!localMatch) {
      await this.otpRepo.save(session);
      const left = Math.max(maxAttempts - session.attempts, 0);
      throw new UnauthorizedException(`Invalid OTP — ${left} attempt(s) left`);
    }

    session.verifiedAt = new Date();
    await this.otpRepo.save(session);
    this.logger.log(`OTP verified for ${mobile} (${purpose})`, 'OtpService');
    return session;
  }

  private generateCode(demoMode: boolean) {
    const length = this.codeLength();
    if (demoMode) return '1'.repeat(length);
    const max = 10 ** length;
    return String(Math.floor(Math.random() * max)).padStart(length, '0');
  }

  private codeLength() {
    return parseInt(this.config.get<string>('OTP_LENGTH') || '4', 10);
  }

  private ttlSeconds() {
    return parseInt(this.config.get<string>('OTP_TTL_SECONDS') || '300', 10);
  }

  private resendIntervalSeconds() {
    return parseInt(
      this.config.get<string>('OTP_RESEND_INTERVAL_SECONDS') || '30',
      10,
    );
  }

  private maxAttempts() {
    return parseInt(this.config.get<string>('OTP_MAX_ATTEMPTS') || '5', 10);
  }

  private demoMode() {
    const flag = (this.config.get<string>('OTP_DEMO_MODE') || '').trim().toLowerCase();
    if (flag === 'true' || flag === '1') return true;
    if (flag === 'false' || flag === '0') return false;
    const provider = (this.config.get<string>('SMS_PROVIDER') || '').trim();
    const apiKey = (this.config.get<string>('SMS_API_KEY') || '').trim();
    return !provider || !apiKey;
  }
}
