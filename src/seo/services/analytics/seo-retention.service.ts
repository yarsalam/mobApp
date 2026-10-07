import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

@Injectable()
export class SEORetentionService {
  private readonly logger = new Logger(SEORetentionService.name);

  constructor(
    // @InjectConnection('analytics')
    @InjectConnection()
    private readonly analyticsConnection: Connection,
  ) {}

  async analyzeCohorts() {
    this.logger.debug('Analyzing SEO retention cohorts...');

    return this.analyticsConnection.query(`
      WITH cohorts AS (
        SELECT 
          DATE_SUB(DATE(u.created_at), INTERVAL WEEKDAY(u.created_at) DAY) as cohort_week,
          u.acquisition_source,
          u.acquisition_keyword,
          COUNT(u.id) as users
        FROM user u
        WHERE u.acquisition_keyword IS NOT NULL
        GROUP BY cohort_week, acquisition_source, acquisition_keyword
      ),
      retention AS (
        SELECT 
          u.acquisition_keyword,
          1.0 * COUNT(DISTINCT CASE WHEN e.created_at > DATE_ADD(u.created_at, INTERVAL 7 DAY) 
                THEN u.id END) / COUNT(DISTINCT u.id) as retention_7d,
          1.0 * COUNT(DISTINCT CASE WHEN e.created_at > DATE_ADD(u.created_at, INTERVAL 30 DAY) 
                THEN u.id END) / COUNT(DISTINCT u.id) as retention_30d,
          AVG(p.amount) as avg_ltv
        FROM user u
        LEFT JOIN user_events e ON e.user_id = u.id
        LEFT JOIN payments p ON p.user_id = u.id AND p.status = 'paid'
        GROUP BY u.acquisition_keyword
      )
      SELECT 
        r.acquisition_keyword,
        r.retention_7d,
        r.retention_30d,
        r.avg_ltv
      FROM retention r
      WHERE r.retention_30d IS NOT NULL
      ORDER BY r.retention_30d DESC
      LIMIT 50
    `);
  }

  async getKeywordRetentionReport() {
    const data = await this.analyzeCohorts();

    return data.map((item) => ({
      keyword: item.acquisition_keyword,
      retention7d: parseFloat(item.retention_7d).toFixed(2),
      retention30d: parseFloat(item.retention_30d).toFixed(2),
      avgLTV: parseFloat(item.avg_ltv).toFixed(2),
      quality: this.getQualityLabel(item.retention_30d, item.avg_ltv),
    }));
  }

  private getQualityLabel(retention30d: string, avgLTV: string): string {
    const r = parseFloat(retention30d);
    const l = parseFloat(avgLTV);

    if (r > 0.3 && l > 200) return '⭐ عالی';
    if (r > 0.2 && l > 100) return '✅ خوب';
    if (r > 0.1) return '🟡 متوسط';
    return '❌ ضعیف';
  }
}
