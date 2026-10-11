import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { createHash, randomInt } from 'crypto';
import { OtpVerification } from 'src/database/entities';
import { CustomLoggerService } from 'src/common/utils/logger.service';
import { SmsService } from 'src/integrations/sms/sms.service';
import { maskMobile, RateLimitStats } from 'src/common/rate-limit/rate-limit.stats';

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

const waitText = (ms: number) => {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes >= 60
    ? `${Math.ceil(minutes / 60)} hour(s)`
    : `${minutes} minute(s)`;
};

@Injectable()
export class OtpService {
  constructor(
    @InjectRepository(OtpVerification)
    private readonly otpRepo: Repository<OtpVerification>,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly logger: CustomLoggerService,
    private readonly dataSource: DataSource,
    private readonly stats: RateLimitStats,
  ) {}

  async send(
    mobile: string,
    purpose: OtpPurpose,
    options: { isResend?: boolean } = {},
  ): Promise<OtpChallenge> {
    const ttl = this.ttlSeconds();
    const resendInterval = this.resendIntervalSeconds();
    const demoMode = this.demoMode();

    const useTwilio = !demoMode && this.sms.usesTwilioVerify();
    const code = this.generateCode(demoMode);

    // One send per number at a time, so parallel requests can't slip past the caps.
    await this.dataSource.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `otp:${mobile}`,
      ]);
      const repo = em.getRepository(OtpVerification);
      await this.assertSendAllowed(repo, mobile);

      const active = await repo.findOne({
        where: {
          mobile,
          purpose,
          verifiedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
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
        await repo.save(active);
      }

      if (options.isResend && !active) {
        throw new BadRequestException('No OTP to resend — request a new one');
      }

      await repo.save(
        repo.create({
          mobile,
          otpHash: hashOtp(useTwilio ? '__twilio_verify__' : code),
          purpose,
          attempts: 0,
          expiresAt: new Date(Date.now() + ttl * 1000),
          verifiedAt: null,
        }),
      );
    });

    if (demoMode) {
      this.logger.log(
        `[otp:demo] ${purpose} ${mobile} code=${code}`,
        'OtpService',
      );
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
    await this.assertNotLockedOut(this.otpRepo, mobile);
    const session = await this.otpRepo.findOne({
      where: { mobile, purpose, verifiedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!session) {
      throw new UnauthorizedException(
        'No OTP requested for this mobile number',
      );
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('OTP expired — request a new one');
    }

    // Count the attempt atomically *before* checking the code: a read-then-save
    // let parallel guesses all pass the limit.
    const maxAttempts = this.maxAttempts();
    const bumped = await this.otpRepo
      .createQueryBuilder()
      .update(OtpVerification)
      .set({ attempts: () => 'attempts + 1' })
      .where('id = :id AND attempts < :max AND verified_at IS NULL', {
        id: session.id,
        max: maxAttempts,
      })
      .returning(['attempts'])
      .execute();
    if (!bumped.affected) {
      throw new UnauthorizedException(
        'Too many wrong attempts — request a new OTP',
      );
    }
    const attempts = Number(
      (bumped.raw as Array<{ attempts: number }>)[0]?.attempts ?? maxAttempts,
    );
    const left = Math.max(maxAttempts - attempts, 0);

    const twilioSent = session.otpHash === hashOtp('__twilio_verify__');
    const localMatch = session.otpHash === hashOtp(code);
    if (twilioSent || (!localMatch && this.sms.usesTwilioVerify())) {
      const check = await this.sms.checkTwilioOtp(mobile, code);
      if (!check.ok && !localMatch) {
        throw new UnauthorizedException(
          `${'error' in check ? check.error : 'Invalid OTP'} — ${left} attempt(s) left`,
        );
      }
    } else if (!localMatch) {
      throw new UnauthorizedException(`Invalid OTP — ${left} attempt(s) left`);
    }

    // Single use: two parallel correct submissions must not both log in.
    const used = await this.otpRepo
      .createQueryBuilder()
      .update(OtpVerification)
      .set({ verifiedAt: () => 'NOW()' })
      .where('id = :id AND verified_at IS NULL', { id: session.id })
      .execute();
    if (!used.affected) {
      throw new UnauthorizedException('OTP already used — request a new one');
    }
    this.logger.log(`OTP verified for ${mobile} (${purpose})`, 'OtpService');
    return session;
  }

  /** Per-number caps, counted in Postgres so they hold across servers even without Redis. */
  private async assertSendAllowed(
    repo: Repository<OtpVerification>,
    mobile: string,
  ) {
    await this.assertNotLockedOut(repo, mobile);
    const [row] = (await repo.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') AS hour,
         COUNT(*) AS day,
         MIN(created_at) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') AS oldest_hour,
         MIN(created_at) AS oldest_day
       FROM otp_verifications
       WHERE mobile = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [mobile],
    )) as Array<{
      hour: string;
      day: string;
      oldest_hour: Date | null;
      oldest_day: Date | null;
    }>;
    const perHour = this.intConfig('OTP_MAX_SENDS_PER_HOUR', 5);
    const perDay = this.intConfig('OTP_MAX_SENDS_PER_DAY', 10);
    if (Number(row.day) >= perDay && row.oldest_day) {
      throw this.tooMany(
        'otp-number-daily',
        mobile,
        `Too many OTP requests for this number. Try again in ${waitText(new Date(row.oldest_day).getTime() + 86_400_000 - Date.now())}.`,
      );
    }
    if (Number(row.hour) >= perHour && row.oldest_hour) {
      throw this.tooMany(
        'otp-number-hourly',
        mobile,
        `Too many OTP requests for this number. Try again in ${waitText(new Date(row.oldest_hour).getTime() + 3_600_000 - Date.now())}.`,
      );
    }
  }

  /** Wrong guesses across all codes for a number in the last hour. */
  private async assertNotLockedOut(
    repo: Repository<OtpVerification>,
    mobile: string,
  ) {
    const max = this.intConfig('OTP_MAX_FAILED_PER_HOUR', 10);
    const [row] = (await repo.query(
      `SELECT COALESCE(SUM(attempts), 0) AS failed, MIN(created_at) AS oldest
       FROM otp_verifications
       WHERE mobile = $1 AND verified_at IS NULL AND attempts > 0
         AND created_at > NOW() - INTERVAL '1 hour'`,
      [mobile],
    )) as Array<{ failed: string; oldest: Date | null }>;
    if (Number(row.failed) >= max) {
      const wait = row.oldest
        ? new Date(row.oldest).getTime() + 3_600_000 - Date.now()
        : 3_600_000;
      throw this.tooMany(
        'otp-number-lockout',
        mobile,
        `Too many wrong OTP attempts for this number. Try again in ${waitText(wait)}.`,
      );
    }
  }

  private tooMany(bucket: string, mobile: string, message: string) {
    this.stats.record(bucket, `mobile:${maskMobile(mobile)}`);
    return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }

  private intConfig(name: string, fallback: number) {
    const value = parseInt(this.config.get<string>(name) || '', 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private generateCode(demoMode: boolean) {
    const length = this.codeLength();
    if (demoMode) return '1'.repeat(length);
    return String(randomInt(0, 10 ** length)).padStart(length, '0');
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
    const flag = (this.config.get<string>('OTP_DEMO_MODE') || '')
      .trim()
      .toLowerCase();
    if (flag === 'true' || flag === '1') return true;
    if (flag === 'false' || flag === '0') return false;
    const provider = (this.config.get<string>('SMS_PROVIDER') || '').trim();
    const apiKey = (this.config.get<string>('SMS_API_KEY') || '').trim();
    return !provider || !apiKey;
  }
}
