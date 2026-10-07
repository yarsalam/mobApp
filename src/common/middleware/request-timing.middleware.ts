import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PerformanceMetricsService } from '../services/performance-metrics.service';

@Injectable()
export class RequestTimingMiddleware implements NestMiddleware {
  constructor(private readonly metrics: PerformanceMetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      // >=500 را خطای سیستمی حساب می‌کنیم؛ 4xx خطای کاربر است نه علامت ناسالمی سرور
      const isError = res.statusCode >= 500;
      this.metrics.record(durationMs, isError);
    });

    next();
  }
}
