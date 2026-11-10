import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisService } from './redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  // Liveness: the process is running. Does not imply dependency readiness.
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // Readiness: verify the dependencies required by the API are reachable.
  // Do not expose raw database/Redis errors or credentials in the response.
  @Get('ready')
  async readiness() {
    const [databaseReady, redisReady] = await Promise.all([
      this.dataSource.query('SELECT 1').then(() => true).catch(() => false),
      this.redisService.ping().then(() => true).catch(() => false),
    ]);

    const checks = {
      database: databaseReady ? 'ok' : 'unavailable',
      redis: redisReady ? 'ok' : 'unavailable',
    };

    if (!databaseReady || !redisReady) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'ready',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
