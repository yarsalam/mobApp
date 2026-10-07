import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
// import { ApiKeyGuard } from '../admin-api/guards/api-key.guard';
import { OpsHealthService } from './ops.health.service';

/**
 * OpsController
 *
 * Mount در ops.module.ts:
 *   @Module({
 *     imports: [TypeOrmModule.forFeature([...]), BullModule.registerQueue(...), HttpModule],
 *     controllers: [OpsController],
 *     providers:   [OpsHealthService],
 *   })
 *   export class OpsModule {}
 *
 * و در app.module.ts:
 *   imports: [..., OpsModule]
 *
 * تمام route ها نیاز به API-Key دارند (همان guard ادمین).
 * اگر می‌خواهی برای داشبورد داخلی بدون guard باشد، UseGuards را بردار.
 */
// @UseGuards(ApiKeyGuard)
@Controller('ops')
export class OpsController {
  constructor(
    private readonly health: OpsHealthService,
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // GET /ops/health
  // وضعیت کامل infrastructure + سرویس‌های AI
  // ─────────────────────────────────────────────────────────────────────────
  @Get('health')
  async getHealth() {
    return this.health.fullHealth();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /ops/ai/models
  // وضعیت هر مدل AI به همراه آخرین run، latency، و accuracy
  // ─────────────────────────────────────────────────────────────────────────
  @Get('ai/models')
  async getAIModels() {
    const services = await this.health.checkAIServices();

    // هر سرویس می‌تواند /health خود را با متادیتای مدل غنی کند.
    // اینجا از status.model_info که سرویس‌های Python ارسال می‌کنند استفاده می‌شود.
    return Object.entries(services).map(([name, s]: [string, any]) => ({
      name,
      status: s.status,
      latencyMs: s.latencyMs,
      error: s.error ?? null,
      // فیلدهای زیر از خود /health سرویس Python می‌آیند
      lastRun: s.status?.last_run ?? null,
      accuracy: s.status?.accuracy ?? null,
      modelVer: s.status?.model_version ?? null,
      queueDepth: s.status?.queue_depth ?? null,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /ops/flows
  // وضعیت پوشش هر Business Flow بر اساس بررسی واقعی زیرساخت
  // ─────────────────────────────────────────────────────────────────────────
  @Get('flows')
  async getFlows() {
    const [mysql, redis, bullmq, qdrant, aiServices] = await Promise.all([
      this.health.checkMySQL(),
      this.health.checkRedis(),
      this.health.checkBullMQ(),
      this.health.checkQdrant(),
      this.health.checkAIServices(),
    ]);

    const ml = aiServices['ml_service']?.status !== 'down';
    const mod = aiServices['moderation']?.status !== 'down';
    const emb = aiServices['embedded_ai']?.status !== 'down';
    const per = aiServices['personality']?.status !== 'down';

    const flows = [
      {
        id: 'registration',
        name: 'ثبت‌نام کامل',
        steps: [
          {
            label: 'MySQL / user',
            ok: mysql.status !== 'down',
            critical: true,
          },
          { label: 'Redis / OTP', ok: redis.status !== 'down', critical: true },
          { label: 'BullMQ', ok: bullmq.status !== 'down', critical: false },
          { label: 'Personality AI', ok: per, critical: false },
          {
            label: 'Qdrant embed',
            ok: emb && qdrant.status !== 'down',
            critical: false,
          },
        ],
      },
      {
        id: 'feed',
        name: 'فید و پیشنهاد',
        steps: [
          { label: 'MySQL', ok: mysql.status !== 'down', critical: true },
          { label: 'Qdrant', ok: qdrant.status !== 'down', critical: true },
          { label: 'ML Matching', ok: ml, critical: true },
          {
            label: 'Redis cache',
            ok: redis.status !== 'down',
            critical: false,
          },
          { label: 'Embedded AI', ok: emb, critical: false },
        ],
      },
      {
        id: 'message',
        name: 'پیام',
        steps: [
          { label: 'MySQL', ok: mysql.status !== 'down', critical: true },
          { label: 'Moderation AI', ok: mod, critical: false },
          {
            label: 'Redis unread',
            ok: redis.status !== 'down',
            critical: false,
          },
          {
            label: 'BullMQ notify',
            ok: bullmq.status !== 'down',
            critical: false,
          },
        ],
      },
      {
        id: 'matching',
        name: 'لایک و مچ',
        steps: [
          { label: 'MySQL', ok: mysql.status !== 'down', critical: true },
          { label: 'ML Matching', ok: ml, critical: false },
          {
            label: 'BullMQ notify',
            ok: bullmq.status !== 'down',
            critical: false,
          },
          {
            label: 'Redis cache',
            ok: redis.status !== 'down',
            critical: false,
          },
        ],
      },
      {
        id: 'payment',
        name: 'پرداخت',
        steps: [
          { label: 'MySQL', ok: mysql.status !== 'down', critical: true },
          { label: 'Redis', ok: redis.status !== 'down', critical: false },
        ],
      },
      {
        id: 'ai_assistant',
        name: 'دستیار AI',
        steps: [
          { label: 'MySQL', ok: mysql.status !== 'down', critical: true },
          { label: 'Embedded AI', ok: emb, critical: true },
          { label: 'Redis', ok: redis.status !== 'down', critical: false },
        ],
      },
      {
        id: 'support',
        name: 'تیکت پشتیبانی',
        steps: [
          { label: 'MySQL', ok: mysql.status !== 'down', critical: true },
          { label: 'PUBLIC controller', ok: true, critical: true },
          {
            label: 'AI Support',
            ok: aiServices['ai_support']?.status !== 'down',
            critical: false,
          },
        ],
      },
    ];

    return flows.map((f) => {
      const total = f.steps.length;
      const okCount = f.steps.filter((s) => s.ok).length;
      const criticalDown = f.steps.filter((s) => s.critical && !s.ok).length;
      const coverage = Math.round((okCount / total) * 100);
      const status =
        criticalDown > 0 ? 'critical' : coverage < 80 ? 'degraded' : 'healthy';
      return { ...f, coverage, status };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /ops/traces/:traceId
  // جزئیات trace یک درخواست — از request_log یا APM می‌آید
  // ─────────────────────────────────────────────────────────────────────────
  @Get('traces/:traceId')
  async getTrace(@Param('traceId') traceId: string) {
    // اگر request_log جدول داری، اینجا query بزن.
    // این template پایه است — schema را با نام جدول خودت عوض کن.
    const rows = await this.db.query(
      `SELECT service, action, duration_ms, status, created_at, meta
       FROM request_log
       WHERE trace_id = ?
       ORDER BY created_at ASC
       LIMIT 200`,
      [traceId],
    );

    if (!rows.length) {
      throw new NotFoundException(`trace ${traceId} پیدا نشد`);
    }

    const totalMs = rows.reduce(
      (sum: number, r: any) => sum + (r.duration_ms ?? 0),
      0,
    );
    return {
      traceId,
      totalMs,
      steps: rows.map((r: any) => ({
        service: r.service,
        action: r.action,
        durationMs: r.duration_ms,
        status: r.status,
        at: r.created_at,
        meta: typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /feed/explain/:userId
  // (این endpoint باید در FeedController باشد — اینجا برای مرجع)
  //
  // خروجی: Trust، Similarity، LTR، Diversity، Phase، finalScore
  // ─────────────────────────────────────────────────────────────────────────
  // @Get('/explain/feed/:userId')
  // async explainFeed(@Param('userId') userId: string) {
  //   const uid = parseInt(userId, 10);

  //   // این query ها را با service های واقعی خودت جایگزین کن
  //   const [featureRow, metricsRow, phaseRow] = await Promise.all([
  //     this.db.query(
  //       `SELECT trust_score, similarity_score, ltr_score, diversity_boost
  //        FROM user_features WHERE user_id = ? LIMIT 1`,
  //       [uid],
  //     ),
  //     this.db.query(
  //       `SELECT engagement_score FROM user_daily_metrics
  //        WHERE user_id = ? ORDER BY date DESC LIMIT 1`,
  //       [uid],
  //     ),
  //     this.db.query(
  //       `SELECT phase, phase_score FROM user_phases WHERE user_id = ? LIMIT 1`,
  //       [uid],
  //     ),
  //   ]);

  //   const f = featureRow[0] ?? {};
  //   const m = metricsRow[0] ?? {};
  //   const p = phaseRow[0] ?? {};

  //   const trust = parseFloat(f.trust_score ?? 0);
  //   const similarity = parseFloat(f.similarity_score ?? 0);
  //   const ltr = parseFloat(f.ltr_score ?? 0);
  //   const diversity = parseFloat(f.diversity_boost ?? 0);
  //   const phase = parseFloat(p.phase_score ?? 0);
  //   const engagement = parseFloat(m.engagement_score ?? 0);

  //   // وزن‌دهی — با FeatureScoringService یا config خودت تنظیم کن
  //   const finalScore =
  //     trust * 0.3 +
  //     similarity * 0.25 +
  //     ltr * 0.2 +
  //     diversity * 0.1 +
  //     phase * 0.1 +
  //     engagement * 0.05;

  //   return {
  //     userId: uid,
  //     phase: p.phase ?? null,
  //     scores: { trust, similarity, ltr, diversity, phase, engagement },
  //     finalScore: Math.round(finalScore * 1000) / 1000,
  //     sources: {
  //       trust: 'user_features.trust_score',
  //       similarity: 'user_features.similarity_score',
  //       ltr: 'user_features.ltr_score',
  //       diversity: 'user_features.diversity_boost',
  //       phase: 'user_phases.phase_score',
  //       engagement: 'user_daily_metrics.engagement_score',
  //     },
  //   };
  // }
  @Get('/explain/feed/:userId')
  async explainFeed(@Param('userId') userId: string) {
    const uid = parseInt(userId, 10);
    return this.health.getFeedExplain(uid);
  }
  // ─────────────────────────────────────────────────────────────────────────
  // GET /ops/queues
  // وضعیت لحظه‌ای تمام صف‌های BullMQ
  // ─────────────────────────────────────────────────────────────────────────
  @Get('queues')
  async getQueues() {
    const result = await this.health.checkBullMQ();
    return result;
  }
}
