import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { tap } from 'rxjs';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';

@Injectable()
export class TraceInterceptor implements NestInterceptor {
  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();

    const traceId = req.headers['x-trace-id'] || crypto.randomUUID();

    const start = Date.now();

    return next.handle().pipe(
      tap(async () => {
        try {
          await this.ds.query(
            `INSERT INTO request_log
         (trace_id, flow, service, action, duration_ms, status)
         VALUES (?,?,?,?,?,?)`,
            [
              traceId,
              req.route?.path,
              'nestjs',
              `${req.method} ${req.originalUrl}`,
              Date.now() - start,
              200,
            ],
          );
        } catch (e) {
          // اضافه کردن این log مشکل را آشکار می‌کند
          console.error('[TraceInterceptor] INSERT failed:', e.message);
        }
      }),
    );
  }
}
