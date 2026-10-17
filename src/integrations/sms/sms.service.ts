import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpDeliveryChannel } from 'src/common/types/otp.types';
import { CustomLoggerService } from 'src/common/utils/logger.service';

export type SmsResult = {
  delivered: boolean;
  provider: string;
  error?: string;
};

/**
 * Sends OTP SMS. Local/demo logs the code. Production needs SMS_PROVIDER + SMS_API_KEY:
 * - fast2sms  SMS_API_KEY
 * - msg91     SMS_API_KEY + SMS_OTP_TEMPLATE_ID
 * - apitxt    SMS_API_KEY; channel-specific template settings are optional
 * - twilio    SMS_API_KEY + SMS_API_SECRET, and optionally SMS_TWILIO_VERIFY_SERVICE_SID
 *             (trial accounts cannot send custom SMS; OTP uses Twilio Verify templates)
 */
@Injectable()
export class SmsService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: CustomLoggerService,
  ) {}

  async sendOtp(
    mobile: string,
    code: string,
    channel?: OtpDeliveryChannel,
  ) {
    const provider = (this.config.get<string>('SMS_PROVIDER') || '').trim().toLowerCase();
    if (provider === 'twilio') {
      if (channel && channel !== 'sms') {
        return {
          delivered: false,
          provider,
          error: 'WhatsApp and voice OTP delivery require the APITXT provider',
        };
      }
      return this.sendTwilioVerify(mobile);
    }
    if (provider === 'apitxt') return this.sendApiTxtOtp(mobile, code, channel);
    if (channel && channel !== 'sms') {
      return {
        delivered: false,
        provider: provider || 'stub',
        error: 'WhatsApp and voice OTP delivery require the APITXT provider',
      };
    }
    const template =
      this.config.get<string>('SMS_OTP_TEMPLATE') ||
      'Your Szoop verification code is {{code}}. It expires shortly.';
    return this.send(mobile, template.replace('{{code}}', code), code);
  }

  async send(mobile: string, message: string, otp?: string): Promise<SmsResult> {
    const provider = (this.config.get<string>('SMS_PROVIDER') || '').trim().toLowerCase();
    const apiKey = (this.config.get<string>('SMS_API_KEY') || '').trim();

    if (provider === 'twilio') {
      this.logger.log(
        `[sms:skip] Twilio Verify is login-only. Not texting ${mobile}`,
        'SmsService',
      );
      return {
        delivered: false,
        provider: 'twilio',
        error: 'Twilio Verify is only used for login OTP',
      };
    }

    if (!provider || !apiKey) {
      this.logger.log(`[sms:stub] to=${mobile} message="${message}"`, 'SmsService');
      return {
        delivered: false,
        provider: 'stub',
        error: 'SMS provider is not configured on the server',
      };
    }

    try {
      if (provider === 'fast2sms') return await this.sendFast2Sms(apiKey, mobile, otp, message);
      if (provider === 'msg91') return await this.sendMsg91(apiKey, mobile, otp, message);
      return { delivered: false, provider, error: `Unknown SMS_PROVIDER "${provider}"` };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'SMS send failed';
      this.logger.error(`SMS to ${mobile} failed: ${error}`, undefined, 'SmsService');
      return { delivered: false, provider, error };
    }
  }

  private async sendFast2Sms(
    apiKey: string,
    mobile: string,
    otp: string | undefined,
    message: string,
  ): Promise<SmsResult> {
    const body = otp
      ? { route: 'otp', variables_values: otp, numbers: mobile }
      : { route: 'q', message, numbers: mobile };
    const res = await this.postJson('https://www.fast2sms.com/dev/bulkV2', body, {
      authorization: apiKey,
    });
      const ok = res.status < 400 && res.json?.['return'] !== false;
    if (!ok) {
      return {
        delivered: false,
        provider: 'fast2sms',
        error: this.stringifyError(res.json) || `HTTP ${res.status}`,
      };
    }
    this.logger.log(`OTP SMS sent via Fast2SMS to ${mobile}`, 'SmsService');
    return { delivered: true, provider: 'fast2sms' };
  }

  private async sendMsg91(
    apiKey: string,
    mobile: string,
    otp: string | undefined,
    message: string,
  ): Promise<SmsResult> {
    const templateId = (this.config.get<string>('SMS_OTP_TEMPLATE_ID') || '').trim();
    const sender = (this.config.get<string>('SMS_SENDER_ID') || '').trim();
    if (otp && templateId) {
      const res = await this.postJson(
        'https://control.msg91.com/api/v5/otp',
        {
          template_id: templateId,
          mobile: `91${mobile}`,
          otp,
          sender: sender || undefined,
        },
        { authkey: apiKey, Accept: 'application/json' },
      );
      const type = String(res.json?.type || '').toLowerCase();
      const ok = res.status < 400 && type !== 'error';
      if (!ok) {
        return {
          delivered: false,
          provider: 'msg91',
          error: this.stringifyError(res.json) || `HTTP ${res.status}`,
        };
      }
      this.logger.log(`OTP SMS sent via MSG91 to ${mobile}`, 'SmsService');
      return { delivered: true, provider: 'msg91' };
    }

    const res = await this.postJson(
      'https://control.msg91.com/api/v5/flow/',
      {
        template_id: templateId || undefined,
        recipients: [{ mobiles: `91${mobile}`, VAR1: otp ?? message }],
      },
      { authkey: apiKey, Accept: 'application/json' },
    );
    const ok = res.status < 400;
    return ok
      ? { delivered: true, provider: 'msg91' }
      : {
          delivered: false,
          provider: 'msg91',
          error: this.stringifyError(res.json) || `HTTP ${res.status}`,
        };
  }

  private async sendApiTxtOtp(
    mobile: string,
    otp: string,
    requestedChannel?: OtpDeliveryChannel,
  ): Promise<SmsResult> {
    const apiKey = (this.config.get<string>('SMS_API_KEY') || '').trim();
    if (!apiKey) {
      return {
        delivered: false,
        provider: 'apitxt',
        error: 'Missing APITXT configuration: SMS_API_KEY',
      };
    }

    const channel = (requestedChannel || this.config.get<string>('SMS_CHANNEL') || 'sms')
      .trim()
      .toLowerCase();
    if (!['sms', 'whatsapp', 'voice'].includes(channel)) {
      return {
        delivered: false,
        provider: 'apitxt',
        error: 'SMS_CHANNEL must be sms, whatsapp, or voice',
      };
    }

    const params = new URLSearchParams({ authkey: apiKey, mobile, otp });
    if (channel !== 'sms' || this.config.get<string>('SMS_CHANNEL')?.trim()) {
      params.set('channel', channel);
    }

    const country = (this.config.get<string>('SMS_COUNTRY') || '').trim();
    if (country) params.set('country', country);

    if (channel === 'sms') {
      const templateId = (
        this.config.get<string>('SMS_OTP_TEMPLATE_ID') || ''
      ).trim();
      if (templateId) params.set('template_id', templateId);
    } else if (channel === 'whatsapp') {
      const templateName = (
        this.config.get<string>('SMS_OTP_TEMPLATE_NAME') || ''
      ).trim();
      const projectRefId = (
        this.config.get<string>('SMS_PROJECT_REF_ID') || ''
      ).trim();
      if (templateName) params.set('template_name', templateName);
      if (projectRefId) params.set('project_ref_id', projectRefId);
    }

    try {
      const res = await fetch('https://apitxt.com/api/sendOTP', {
        method: 'POST',
        body: params.toString(),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      let json: Record<string, unknown> | null = null;
      if (text) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === 'object') {
            json = parsed as Record<string, unknown>;
          }
        } catch {
          json = { message: text };
        }
      }

      const status = String(json?.status ?? json?.type ?? '').toLowerCase();
      const rejected =
        json?.success === false ||
        json?.return === false ||
        status === 'error' ||
        status === 'failed' ||
        Boolean(json?.error);
      if (!res.ok || rejected) {
        return {
          delivered: false,
          provider: 'apitxt',
          error: this.stringifyError(json) || `APITXT returned HTTP ${res.status}`,
        };
      }
      this.logger.log(`OTP sent via APITXT (${channel}) to ${mobile}`, 'SmsService');
      return { delivered: true, provider: 'apitxt' };
    } catch {
      this.logger.error('APITXT OTP request failed', undefined, 'SmsService');
      return {
        delivered: false,
        provider: 'apitxt',
        error: 'Could not connect to the APITXT SMS service',
      };
    }
  }

  usesTwilioVerify() {
        return (this.config.get<string>('SMS_PROVIDER') || '').trim().toLowerCase() === 'twilio';
  }

  async checkTwilioOtp(mobile: string, code: string): Promise<
    { ok: true } | { ok: false; error: string }
  > {
    const serviceSid = await this.getTwilioVerifyServiceSid();
    if (serviceSid.ok === false) return { ok: false, error: serviceSid.error };
    const res = await this.twilioForm(
      `https://verify.twilio.com/v2/Services/${serviceSid.sid}/VerificationCheck`,
      { To: `+91${mobile}`, Code: code },
    );
    const status = String(res.json?.status || '').toLowerCase();
    if (status === 'approved') return { ok: true };
    return {
      ok: false,
      error: this.stringifyError(res.json) || 'Invalid OTP',
    };
  }

  private async sendTwilioVerify(mobile: string): Promise<SmsResult> {
    const serviceSid = await this.getTwilioVerifyServiceSid();
    if (serviceSid.ok === false) {
      return { delivered: false, provider: 'twilio', error: serviceSid.error };
    }
    const res = await this.twilioForm(
      `https://verify.twilio.com/v2/Services/${serviceSid.sid}/Verifications`,
      { To: `+91${mobile}`, Channel: 'sms' },
    );
    const status = String(res.json?.status || '').toLowerCase();
    if (!res.ok || (status && status !== 'pending')) {
      return {
        delivered: false,
        provider: 'twilio',
        error:
          this.twilioFriendlyError(res.json) ||
          `Twilio could not send the OTP (HTTP ${res.status})`,
      };
    }
    this.logger.log(`OTP SMS sent via Twilio Verify to ${mobile}`, 'SmsService');
    return { delivered: true, provider: 'twilio' };
  }

  private cachedVerifySid: string | null = null;

  private async getTwilioVerifyServiceSid(): Promise<
    { ok: true; sid: string } | { ok: false; error: string }
  > {
    const fromEnv = (
      this.config.get<string>('SMS_TWILIO_VERIFY_SERVICE_SID') ||
      this.config.get<string>('SMS_OTP_TEMPLATE_ID') ||
      ''
    ).trim();
    if (fromEnv.startsWith('VA')) return { ok: true, sid: fromEnv };
    if (this.cachedVerifySid) return { ok: true, sid: this.cachedVerifySid };

    const listed = await this.twilioForm('https://verify.twilio.com/v2/Services', {}, 'GET');
    const services = (listed.json?.services as { sid?: string; friendly_name?: string }[] | undefined) ?? [];
    const existing =
      services.find((s) => (s.friendly_name || '').toLowerCase() === 'szoop') || services[0];
    if (existing?.sid) {
      this.cachedVerifySid = existing.sid;
      return { ok: true, sid: existing.sid };
    }

    const codeLength = (this.config.get<string>('OTP_LENGTH') || '4').trim();
    const created = await this.twilioForm('https://verify.twilio.com/v2/Services', {
      FriendlyName: 'Szoop',
      CodeLength: codeLength,
    });
    const sid = typeof created.json?.sid === 'string' ? created.json.sid : '';
    if (!created.ok || !sid.startsWith('VA')) {
      return {
        ok: false,
        error:
          this.stringifyError(created.json) ||
          'Create a Verify service in Twilio Console and set SMS_TWILIO_VERIFY_SERVICE_SID (starts with VA).',
      };
    }
    this.cachedVerifySid = sid;
    return { ok: true, sid };
  }

  private twilioFriendlyError(json: Record<string, unknown> | null) {
    const raw = this.stringifyError(json);
    const code = typeof json?.code === 'number' ? json.code : null;
    if (code === 21608 || /unverified|not a valid.*phone|trial|verified tester/i.test(raw)) {
      return (
        raw ||
        'Twilio trial can only text numbers added as verified testers in the Twilio console.'
      );
    }
    if (raw) return raw;
    return code ? `Twilio error ${code}` : '';
  }

  private async twilioForm(
    url: string,
    body: Record<string, string>,
    method: 'POST' | 'GET' = 'POST',
  ) {
    const username = (this.config.get<string>('SMS_API_KEY') || '').trim();
    const password = (this.config.get<string>('SMS_API_SECRET') || '').trim();
    if (!username || !password) {
      return {
        ok: false,
        status: 0,
        json: { message: 'SMS_API_KEY and SMS_API_SECRET are required for Twilio' } as Record<
          string,
          unknown
        >,
      };
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        ...(method === 'POST'
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      body: method === 'POST' ? new URLSearchParams(body).toString() : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, status: res.status, json };
  }

  private async postJson(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, json };
  }

  private stringifyError(json: Record<string, unknown> | null) {
    if (!json) return '';
    const message = json.message ?? json.error ?? json.msg;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
    return '';
  }
}
