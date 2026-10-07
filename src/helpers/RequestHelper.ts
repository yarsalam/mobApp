import { BadRequestException } from '@nestjs/common';
import { Request } from 'express';

export class RequestHelper {
  /**
   * IP واقعی کاربر را از هدرهای reverse-proxy می‌خواند.
   * trust proxy باید در main.ts فعال باشد: app.set('trust proxy', 1)
   */
  static getClientIp(req: Request): string {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string') return fwd.split(',')[0].trim();
    return req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0';
  }

  static getUserAgent(req: Request): string {
    return req.headers['user-agent'] ?? 'unknown';
  }

  static requireDeviceId(req: Request): string {
    const fromMiddleware = (req as any).clientInfo?.deviceId;
    if (typeof fromMiddleware === 'string' && fromMiddleware.length > 0) {
      return fromMiddleware;
    }

    const fromHeader = req.headers['x-device-id'];
    if (typeof fromHeader === 'string' && fromHeader.trim().length > 0) {
      return fromHeader.trim();
    }

    throw new BadRequestException(
      'هدر X-Device-Id الزامی است. هر درخواست باید یک شناسه یکتای دستگاه ارسال کند.',
    );
  }

  /** نسخه non-throwing برای موارد اختیاری */
  static getDeviceId(req: Request): string | undefined {
    const fromMiddleware = (req as any).clientInfo?.deviceId;
    if (typeof fromMiddleware === 'string' && fromMiddleware.length > 0)
      return fromMiddleware;

    const fromHeader = req.headers['x-device-id'];
    return typeof fromHeader === 'string' && fromHeader.trim().length > 0
      ? fromHeader.trim()
      : undefined;
  }
}
