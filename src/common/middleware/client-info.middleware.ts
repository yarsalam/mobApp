import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import * as geoip from 'geoip-lite';
import { ClientInfo } from 'src/types/client-info.type';
import { RequestHelper } from 'src/helpers/RequestHelper';

@Injectable()
export class ClientInfoMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ClientInfoMiddleware.name);

  use(req: Request, _res: Response, next: NextFunction): void {
    const ip = RequestHelper.getClientIp(req);
    const rawDeviceId = req.headers['x-device-id'];

    const clientInfo: ClientInfo = {
      ip,
      platform: this.header(req, 'x-platform'),
      brand: this.header(req, 'x-brand'),
      model: this.header(req, 'x-model'),
      deviceId:
        typeof rawDeviceId === 'string' && rawDeviceId.trim().length > 0
          ? rawDeviceId.trim()
          : undefined,
      appVersion: this.header(req, 'x-app-version'),
      osVersion: this.header(req, 'x-os-version'),
      isVpn: false,
    };

    try {
      const geo = geoip.lookup(ip);
      if (geo) {
        clientInfo.country = geo.country || undefined;
        clientInfo.city = geo.city || undefined;
      }
    } catch (err) {
      this.logger.debug(
        `GeoIP lookup failed for ${ip}: ${(err as Error).message}`,
      );
    }

    req.clientInfo = clientInfo;
    next();
  }

  private header(req: Request, name: string): string | undefined {
    const v = req.headers[name];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }
}
