import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServiceStatus = 'healthy' | 'degraded' | 'critical' | 'down';

export interface CheckResult {
  status: ServiceStatus;
  latencyMs: number;
  detail?: Record<string, any>;
  error?: string;
}

/**
 * وضعیت را بر اساس latency تعیین می‌کند — نه فقط binary ok/down.
 */
function classify(
  ok: boolean,
  latencyMs: number,
  thresholds = { degraded: 500, critical: 2000 },
): ServiceStatus {
  if (!ok) return 'down';
  if (latencyMs >= thresholds.critical) return 'critical';
  if (latencyMs >= thresholds.degraded) return 'degraded';
  return 'healthy';
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class OpsHealthService {
  private readonly logger = new Logger(OpsHealthService.name);

  constructor(
    @InjectDataSource()
    private readonly db: DataSource,

    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,

    @InjectQueue('personality')
    private readonly qPersonality: Queue,

    @InjectQueue('notification')
    private readonly qNotification: Queue,

    @InjectQueue('ai-jobs')
    private readonly qAiJobs: Queue,
  ) {}

  // ── MySQL ──────────────────────────────────────────────────────────────────

  async checkMySQL(): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      await this.db.query('SELECT 1');
      const latencyMs = Date.now() - t0;
      return { status: classify(true, latencyMs), latencyMs };
    } catch (e) {
      return { status: 'down', latencyMs: Date.now() - t0, error: e.message };
    }
  }

  // ── Redis — inject مستقیم، نه از طریق BullMQ ────────────────────────────
  // fix #4

  async checkRedis(): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      const pong = await this.redis.ping();
      const latencyMs = Date.now() - t0;
      if (pong !== 'PONG') throw new Error('unexpected response: ' + pong);
      return {
        status: classify(true, latencyMs, { degraded: 20, critical: 100 }),
        latencyMs,
      };
    } catch (e) {
      return { status: 'down', latencyMs: Date.now() - t0, error: e.message };
    }
  }

  // ── BullMQ ────────────────────────────────────────────────────────────────

  async checkBullMQ(): Promise<CheckResult & { queues: Record<string, any> }> {
    try {
      const queues = await Promise.all([
        this.getQueueStats('personality', this.qPersonality),
        this.getQueueStats('notification', this.qNotification),
        this.getQueueStats('ai-jobs', this.qAiJobs),
      ]);
      const hasFailures = queues.some((q) => q.failed > 0);
      return {
        status: hasFailures ? 'degraded' : 'healthy',
        latencyMs: 0,
        queues: Object.fromEntries(queues.map((q) => [q.name, q])),
      };
    } catch (e) {
      return { status: 'down', latencyMs: 0, queues: {}, error: e.message };
    }
  }

  private async getQueueStats(name: string, queue: Queue) {
    const [waiting, active, failed, completed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getFailedCount(),
      queue.getCompletedCount(),
    ]);
    return { name, waiting, active, failed, completed };
  }

  // ── Qdrant — round-trip واقعی ──────────────────────────────────────────
  // fix #5: upsert → search → delete (نه فقط GET /collections)

  async checkQdrant(
    baseUrl = 'http://qdrant:6333',
    collection = 'user_vectors',
  ): Promise<CheckResult> {
    const t0 = Date.now();
    const testId = 999_999_999; // id که احتمال تداخل با data واقعی ندارد
    try {
      // 1. upsert یک vector موقت
      const upsertRes = await fetch(
        `${baseUrl}/collections/${collection}/points`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            points: [
              {
                id: testId,
                vector: Array(32).fill(0.1),
                payload: { _ops_test: true },
              },
            ],
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!upsertRes.ok) throw new Error(`upsert HTTP ${upsertRes.status}`);

      // 2. search
      const searchRes = await fetch(
        `${baseUrl}/collections/${collection}/points/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vector: Array(32).fill(0.1),
            limit: 1,
            with_payload: false,
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!searchRes.ok) throw new Error(`search HTTP ${searchRes.status}`);

      // 3. delete
      await fetch(`${baseUrl}/collections/${collection}/points/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: [testId] }),
        signal: AbortSignal.timeout(3000),
      });

      const latencyMs = Date.now() - t0;
      return {
        status: classify(true, latencyMs, { degraded: 200, critical: 1000 }),
        latencyMs,
        detail: { collection, roundTrip: 'upsert+search+delete' },
      };
    } catch (e) {
      return { status: 'down', latencyMs: Date.now() - t0, error: e.message };
    }
  }

  // ── Python AI services ────────────────────────────────────────────────────

  private async pingAI(
    name: string,
    url: string,
  ): Promise<{ name: string } & CheckResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const latencyMs = Date.now() - t0;
      if (!res.ok)
        return { name, status: 'down', latencyMs, error: `HTTP ${res.status}` };
      let detail: any = {};
      try {
        detail = await res.json();
      } catch {}
      return {
        name,
        status: classify(true, latencyMs, { degraded: 300, critical: 1500 }),
        latencyMs,
        detail,
      };
    } catch (e) {
      return {
        name,
        status: 'down',
        latencyMs: Date.now() - t0,
        error: e.message,
      };
    }
  }

  async checkAIServices(): Promise<Record<string, any>> {
    const SERVICES = [
      { name: 'ml_service', url: 'http://ml_service:8000/health' },
      { name: 'moderation', url: 'http://ai_moderation:8018/health' },
      { name: 'embedded_ai', url: 'http://embedded_ai:8100/health' },
      { name: 'personality', url: 'http://personality:8100/health' },
      { name: 'ai_image', url: 'http://ai_image:8100/health' },
      { name: 'ai_revenue', url: 'http://ai_revenue:8000/health' },
      { name: 'ai_support', url: 'http://ai_support:8016/health' },
      { name: 'ai_verification', url: 'http://ai_verification:8017/health' },
      { name: 'ai_monetization', url: 'http://ai_monetization:8015/health' },
    ];
    const results = await Promise.allSettled(
      SERVICES.map((s) => this.pingAI(s.name, s.url)),
    );
    return Object.fromEntries(
      results.map((r, i) => [
        SERVICES[i].name,
        r.status === 'fulfilled'
          ? r.value
          : { name: SERVICES[i].name, status: 'down', latencyMs: 0 },
      ]),
    );
  }

  // ── Flow success rates از request_log واقعی ──────────────────────────────
  // fix #1: coverage از لاگ‌های واقعی، نه از binary health چک‌ها

  async getFlowSuccessRates(
    windowMinutes = 15,
  ): Promise<Record<string, number>> {
    try {
      const rows: Array<{ flow: string; total: number; success: number }> =
        await this.db.query(
          `
        SELECT
          flow,
          COUNT(*) AS total,
          SUM(CASE WHEN status < 400 THEN 1 ELSE 0 END) AS success
        FROM request_log
        WHERE created_at >= NOW() - INTERVAL ? MINUTE
          AND flow IS NOT NULL
        GROUP BY flow
      `,
          [windowMinutes],
        );

      const rates: Record<string, number> = {};
      for (const r of rows) {
        rates[r.flow] =
          r.total > 0 ? Math.round((r.success / r.total) * 100) : 0;
      }
      return rates;
    } catch {
      return {}; // اگر جدول request_log نداری، flows از infra health می‌آید
    }
  }

  // ── Business KPIs ─────────────────────────────────────────────────────────
  // fix #2: تب Business برای CEO

  async getBusinessKPIs(): Promise<Record<string, any>> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const queries = await Promise.allSettled([
      // کاربران آنلاین (active در 5 دقیقه اخیر)
      // FIX: users → `user` | last_active → lastActive | is_active=1 → status='active'
      this.db.query(
        `SELECT COUNT(*) AS cnt
         FROM \`user\`
         WHERE lastActive >= NOW() - INTERVAL 5 MINUTE
           AND status = 'active'`,
      ),

      // ثبت‌نام امروز
      // FIX: users → `user` | created_at → createdAt
      this.db.query(
        `SELECT COUNT(*) AS cnt
         FROM \`user\`
         WHERE createdAt >= ?`,
        [todayStart],
      ),

      // مچ‌های امروز
      // FIX: interactions → interaction | created_at: این جدول createdAt دارد
      this.db.query(
        `SELECT COUNT(*) AS cnt
         FROM interaction
         WHERE type = 'match'
           AND createdAt >= ?`,
        [todayStart],
      ),

      // پیام‌های امروز
      // Message entity: created_at صریح تعریف شده → snake_case ✅
      this.db.query(
        `SELECT COUNT(*) AS cnt FROM messages WHERE created_at >= ?`,
        [todayStart],
      ),

      // درآمد امروز
      this.db.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM payments
         WHERE status = 'success' AND created_at >= ?`,
        [todayStart],
      ),

      // پرداخت‌های ناموفق امروز
      this.db.query(
        `SELECT COUNT(*) AS cnt
         FROM payments
         WHERE status = 'failed' AND created_at >= ?`,
        [todayStart],
      ),

      // لایک‌های امروز
      // FIX: interactions → interaction
      this.db.query(
        `SELECT COUNT(*) AS cnt
         FROM interaction
         WHERE type = 'like'
           AND createdAt >= ?`,
        [todayStart],
      ),

      // DAU — FIX: user_id → userId | created_at → createdAt
      this.db.query(
        `SELECT COUNT(DISTINCT userId) AS cnt
         FROM user_events
         WHERE createdAt >= ?`,
        [todayStart],
      ),
    ]);

    const safe = (r: PromiseSettledResult<any>, field = 'cnt') =>
      r.status === 'fulfilled'
        ? parseInt(r.value?.[0]?.[field] ?? 0, 10)
        : null;

    return {
      usersOnline: safe(queries[0]),
      registrationsToday: safe(queries[1]),
      matchesToday: safe(queries[2]),
      messagesToday: safe(queries[3]),
      revenueToday: safe(queries[4], 'total'),
      failedPayments: safe(queries[5]),
      likesToday: safe(queries[6]),
      dau: safe(queries[7]),
      asOf: new Date().toISOString(),
    };
  }

  // ── Feed Explainability با feature contributions ───────────────────────
  // fix #6: نمایش دلایل رتبه‌بندی به شکل LinkedIn/TikTok

  async getFeedExplain(userId: number): Promise<Record<string, any>> {
    try {
      const [snapshotRow, phaseRow, metricsRow, interactionRow, userRow] =
        await Promise.all([
          // user_feature_snapshots — ستون‌ها camelCase ✅
          this.db.query(
            `SELECT trustScore, phase, phaseScore,
                    purchaseProbability, responseProbability, matchProbability,
                    retentionDays
             FROM user_feature_snapshots
             WHERE userId = ?
             LIMIT 1`,
            [userId],
          ),

          // user_phase — ستون‌ها camelCase ✅
          this.db.query(
            `SELECT phase, score
             FROM user_phase
             WHERE userId = ?
             LIMIT 1`,
            [userId],
          ),

          // FIX: LIMIT 1 آخرین روز را می‌گرفت، نه 7 روز
          // حالا SUM از 7 روز گذشته
          this.db.query(
            `SELECT
               COALESCE(SUM(likes),        0) AS likes7d,
               COALESCE(SUM(matches),      0) AS matches7d,
               COALESCE(SUM(messagesSent), 0) AS messagesSent7d,
               COALESCE(SUM(appOpens),     0) AS appOpens7d
             FROM user_daily_metrics
             WHERE userId = ?
               AND metricDate >= CURDATE() - INTERVAL 6 DAY`,
            [userId],
          ),

          // FIX: interactions → interaction
          this.db.query(
            `SELECT COUNT(*) AS like_count
             FROM interaction
             WHERE sender = ?
               AND type = 'like'
               AND createdAt >= NOW() - INTERVAL 7 DAY`,
            [userId],
          ),

          // FIX: users → `user`
          this.db.query(`SELECT city FROM \`user\` WHERE id = ? LIMIT 1`, [
            userId,
          ]),
        ]);

      const snap = snapshotRow[0] ?? {};
      const phaseData = phaseRow[0] ?? {};
      const metrics = metricsRow[0] ?? {};
      const ia = interactionRow[0] ?? {};
      const user = userRow[0] ?? {};

      const trust = parseFloat(snap.trustScore ?? 50) / 100;
      const rawPhaseScore = parseFloat(phaseData.score ?? snap.phaseScore ?? 0);
      const phaseNorm = Math.min(rawPhaseScore / 80, 1);
      const matchProb = parseFloat(snap.matchProbability ?? 0);
      const responseProb = parseFloat(snap.responseProbability ?? 0);
      const purchaseProb = parseFloat(snap.purchaseProbability ?? 0);
      const retentionDays = parseInt(snap.retentionDays ?? 0, 10);
      const recentLikes = parseInt(ia.like_count ?? 0, 10);

      const weights = {
        trust: 0.3,
        matchProbability: 0.25,
        responseProbability: 0.2,
        phase: 0.15,
        purchaseProbability: 0.1,
      };

      const scores = {
        trust,
        matchProbability: matchProb,
        responseProbability: responseProb,
        phase: phaseNorm,
        purchaseProbability: purchaseProb,
      };

      const finalScore =
        trust * weights.trust +
        matchProb * weights.matchProbability +
        responseProb * weights.responseProbability +
        phaseNorm * weights.phase +
        purchaseProb * weights.purchaseProbability;

      const contributions: Array<{
        label: string;
        delta: number;
        source: string;
      }> = [
        {
          label: 'Trust Score',
          delta: +(trust * weights.trust).toFixed(3),
          source: 'user_feature_snapshots.trustScore',
        },
        {
          label: 'Match Probability',
          delta: +(matchProb * weights.matchProbability).toFixed(3),
          source: 'user_feature_snapshots.matchProbability',
        },
        {
          label: 'Response Probability',
          delta: +(responseProb * weights.responseProbability).toFixed(3),
          source: 'user_feature_snapshots.responseProbability',
        },
        {
          label: 'Phase Weight',
          delta: +(phaseNorm * weights.phase).toFixed(3),
          source: 'user_phase.score',
        },
        {
          label: 'Purchase Probability',
          delta: +(purchaseProb * weights.purchaseProbability).toFixed(3),
          source: 'user_feature_snapshots.purchaseProbability',
        },
        ...(responseProb < 0.2
          ? [
              {
                label: 'نرخ پاسخ پایین',
                delta: -0.05,
                source: 'user_feature_snapshots.responseProbability',
              },
            ]
          : []),
        ...(recentLikes > 50
          ? [
              {
                label: 'فعالیت بالا ۷ روز',
                delta: 0.03,
                source: 'interaction.like_count',
              },
            ]
          : []),
      ].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      return {
        userId,
        phase: phaseData.phase ?? snap.phase ?? null,
        city: user.city ?? null,
        scores,
        rawMetrics: {
          likes7d: parseInt(metrics.likes7d ?? 0, 10),
          matches7d: parseInt(metrics.matches7d ?? 0, 10),
          messagesSent7d: parseInt(metrics.messagesSent7d ?? 0, 10),
          appOpens7d: parseInt(metrics.appOpens7d ?? 0, 10),
          retentionDays,
          recentLikes,
        },
        finalScore: Math.round(finalScore * 1000) / 1000,
        weights,
        contributions,
        asOf: new Date().toISOString(),
      };
    } catch (e) {
      this.logger.warn(`getFeedExplain failed for uid=${userId}: ${e.message}`);
      return {
        userId,
        phase: null,
        city: null,
        scores: {
          trust: 0,
          matchProbability: 0,
          responseProbability: 0,
          phase: 0,
          purchaseProbability: 0,
        },
        finalScore: 0,
        weights: {},
        contributions: [],
        rawMetrics: {},
        asOf: new Date().toISOString(),
        _error: 'feature tables not available',
      };
    }
  }

  // ── Full snapshot ─────────────────────────────────────────────────────────

  async fullHealth() {
    const [mysql, redis, bullmq, qdrant, aiServices] = await Promise.all([
      this.checkMySQL(),
      this.checkRedis(),
      this.checkBullMQ(),
      this.checkQdrant(),
      this.checkAIServices(),
    ]);

    const statuses = [
      mysql.status,
      redis.status,
      bullmq.status,
      qdrant.status,
      ...Object.values(aiServices).map((s: any) => s.status),
    ];

    const overall = statuses.includes('down')
      ? 'critical'
      : statuses.includes('critical')
        ? 'critical'
        : statuses.includes('degraded')
          ? 'degraded'
          : 'healthy';

    return {
      timestamp: new Date().toISOString(),
      overall,
      infrastructure: { mysql, redis, bullmq, qdrant },
      aiServices,
    };
  }
}
