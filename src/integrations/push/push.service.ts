import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomLoggerService } from 'src/common/utils/logger.service';

/** Push is best-effort; a slow provider must not hold up the request that triggered it. */
const PUSH_TIMEOUT_MS = 5000;

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Android channel the app created; defaults to 'jobs'. */
  channelId?: string;
  /** A sound file bundled in the app (e.g. 'job_ring.wav'); defaults to the phone's sound. */
  sound?: string;
}

/**
 * FCM delivery. Without FCM_SERVER_KEY this logs instead of sending, so the
 * in-app notification row is still the source of truth for the mobile apps.
 */
@Injectable()
export class PushService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: CustomLoggerService,
  ) {}

  async sendToTokens(tokens: string[], payload: PushPayload) {
    const unique = [...new Set(tokens.filter(Boolean))];
    if (!unique.length) return { sent: 0, provider: 'none' };

    const expo = unique.filter((token) => token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken'));
    const fcm = unique.filter((token) => !expo.includes(token));
    const sentExpo = await this.sendExpo(expo, payload);
    const sentFcm = await this.sendFcm(fcm, payload);
    return { sent: sentExpo + sentFcm, provider: expo.length ? 'expo' : 'fcm' };
  }

  /** Expo tokens show as a lock-screen alert in Expo Go and dev builds. */
  private async sendExpo(tokens: string[], payload: PushPayload) {
    if (!tokens.length) return 0;
    const messages = tokens.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      sound: payload.sound ?? 'default',
      priority: 'high',
      channelId: payload.channelId ?? 'jobs',
      data: payload.data ?? {},
    }));
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Expo push responded ${response.status}`, 'PushService');
        return 0;
      }
      this.logger.log(`Lock-screen push sent to ${tokens.length} device(s): ${payload.title}`, 'PushService');
      return tokens.length;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Expo push failed';
      this.logger.warn(`Expo push failed: ${error}`, 'PushService');
      return 0;
    }
  }

  private async sendFcm(tokens: string[], payload: PushPayload) {
    if (!tokens.length) return 0;
    const serverKey = this.config.get<string>('FCM_SERVER_KEY');
    if (!serverKey) {
      this.logger.log(
        `[push:stub] tokens=${tokens.length} title="${payload.title}"`,
        'PushService',
      );
      return 0;
    }

    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${serverKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        registration_ids: tokens,
        priority: 'high',
        notification: {
          title: payload.title,
          body: payload.body,
          sound: payload.sound ?? 'default',
          android_channel_id: payload.channelId ?? 'jobs',
        },
        data: payload.data ?? {},
      }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    }).catch((err: unknown) => {
      this.logger.warn(`FCM push failed: ${err instanceof Error ? err.message : err}`, 'PushService');
      return null;
    });

    if (!response) return 0;
    if (!response.ok) {
      this.logger.warn(
        `FCM responded ${response.status} for ${tokens.length} token(s)`,
        'PushService',
      );
      return 0;
    }
    return tokens.length;
  }
}
