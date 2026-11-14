import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createSign, createPrivateKey } from 'crypto';
import { Repository } from 'typeorm';
import { AppNotification, NotificationType } from '../entities/notification.entity';
import { UserDevice } from 'src/user-device/entities/user-device.entity';

type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

type OAuthTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
};

@Injectable()
export class PushChannel {
  private readonly logger = new Logger(PushChannel.name);
  private cachedAccessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private credentials: FirebaseServiceAccount | null | undefined;

  constructor(
    @InjectRepository(UserDevice)
    private readonly deviceRepo: Repository<UserDevice>,
  ) {}

  private getCredentials(): FirebaseServiceAccount | null {
    if (this.credentials !== undefined) return this.credentials;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      this.credentials = null;
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<FirebaseServiceAccount>;
      if (
        typeof parsed.project_id !== 'string' ||
        typeof parsed.client_email !== 'string' ||
        typeof parsed.private_key !== 'string'
      ) {
        throw new Error('Required service-account fields are missing');
      }
      const privateKey = parsed.private_key.replace(/\\n/g, '\n');
      // Validate the private key during configuration checks, before any
      // notifications are selected for a remote delivery attempt.
      createPrivateKey(privateKey);
      this.credentials = {
        project_id: parsed.project_id,
        client_email: parsed.client_email,
        private_key: privateKey,
      };
      return this.credentials;
    } catch {
      this.logger.error(
        'FIREBASE_SERVICE_ACCOUNT_JSON is not valid service-account JSON; remote push is disabled',
      );
      this.credentials = null;
      return null;
    }
  }

  isConfigured(): boolean {
    return Boolean(this.getCredentials());
  }

  async hasEnabledDevice(userId: number): Promise<boolean> {
    const device = await this.deviceRepo
      .createQueryBuilder('device')
      .select(['device.id'])
      .where('device.userId = :userId', { userId })
      .andWhere('device.pushEnabled = :enabled', { enabled: true })
      .andWhere('device.pushToken IS NOT NULL')
      .getOne();
    return Boolean(device);
  }

  private base64Url(value: string | Buffer): string {
    return Buffer.from(value).toString('base64url');
  }

  private async getAccessToken(): Promise<string | null> {
    const credentials = this.getCredentials();
    if (!credentials) return null;

    if (
      this.cachedAccessToken &&
      Date.now() < this.accessTokenExpiresAt - 60_000
    ) {
      return this.cachedAccessToken;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = this.base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = this.base64Url(
      JSON.stringify({
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    );
    const unsigned = `${header}.${claims}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const assertion = `${unsigned}.${signer.sign(credentials.private_key, 'base64url')}`;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      this.logger.error(`Firebase OAuth token request failed: HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as OAuthTokenResponse;
    if (!data.access_token) {
      this.logger.error('Firebase OAuth response did not include an access token');
      return null;
    }

    this.cachedAccessToken = data.access_token;
    this.accessTokenExpiresAt =
      Date.now() + Math.max(60, Number(data.expires_in ?? 3600)) * 1000;
    return this.cachedAccessToken;
  }

  private isWithinContactHours(
    timezone: string | null | undefined,
    now: Date,
  ): boolean {
    if (!timezone) return false;
    try {
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(now),
      );
      return Number.isInteger(hour) && hour >= 9 && hour < 21;
    } catch {
      return false;
    }
  }

  async send(notif: AppNotification): Promise<boolean> {
    const credentials = this.getCredentials();
    if (!credentials) return false;

    const devices = await this.deviceRepo
      .createQueryBuilder('device')
      .addSelect('device.pushToken')
      .where('device.userId = :userId', { userId: notif.user_id })
      .andWhere('device.pushEnabled = :enabled', { enabled: true })
      .andWhere('device.pushToken IS NOT NULL')
      .getMany();

    const now = new Date();
    const eligibleDevices =
      notif.type === NotificationType.REENGAGEMENT
        ? devices.filter((device) =>
            this.isWithinContactHours(device.timezone, now),
          )
        : devices;
    const tokenRows = eligibleDevices.filter((device) =>
      Boolean(device.pushToken),
    );
    if (tokenRows.length === 0) return false;

    const accessToken = await this.getAccessToken();
    if (!accessToken) return false;

    let delivered = false;
    for (const device of tokenRows) {
      const token = device.pushToken;
      if (!token) continue;

      try {
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.project_id)}/messages:send`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                token,
                notification: {
                  title: 'یارسلام',
                  body: notif.message,
                },
                data: {
                  notificationId: String(notif.id),
                  type: String(notif.type),
                  screen: 'Notifications',
                },
                android: {
                  priority: 'HIGH',
                  notification: {
                    channel_id: 'default_channel_v2',
                    sound: 'default',
                  },
                },
                apns: {
                  headers: { 'apns-priority': '10' },
                  payload: { aps: { sound: 'default' } },
                },
              },
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );

        if (response.ok) {
          delivered = true;
          continue;
        }

        const errorBody = (await response.json().catch(() => null)) as
          | {
              error?: {
                details?: Array<{ errorCode?: string }>;
              };
            }
          | null;
        const errorCode = errorBody?.error?.details?.find(
          (detail) => detail.errorCode,
        )?.errorCode;

        if (errorCode === 'UNREGISTERED') {
          await this.deviceRepo.update(device.id, {
            pushToken: null,
            pushEnabled: false,
          });
        } else {
          // Never log the device token or service-account material.
          this.logger.warn(
            `FCM send failed for device row ${device.id}: HTTP ${response.status}`,
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `FCM transport failed for device row ${device.id}: ${message}`,
        );
      }
    }
    return delivered;
  }
}
