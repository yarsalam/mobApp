import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Observable, tap } from 'rxjs';
import * as crypto from 'crypto';

@Injectable()
export class TraceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TraceInterceptor.name);

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const traceId =
      req.headers['x-trace-id']?.toString() || crypto.randomUUID();

    const start = Date.now();

    res.setHeader('X-Trace-Id', traceId);

    const saveLog = async (status: number): Promise<void> => {
      try {
        await this.ds.query(
          `INSERT INTO request_log
            (trace_id, flow, service, action, duration_ms, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            traceId,
            req.route?.path ?? req.path ?? null,
            'nestjs',
            `${req.method} ${req.originalUrl ?? req.url}`,
            Date.now() - start,
            status,
          ],
        );
      } catch (error) {
        this.logger.error(
          `Failed to save trace ${traceId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    return next.handle().pipe(
      tap({
        complete: () => {
          void saveLog(res.statusCode ?? 200);
        },
        error: () => {
          void saveLog(res.statusCode ?? 500);
        },
      }),
    );
  }
}
