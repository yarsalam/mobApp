import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';

interface BehavioralKeywordRow {
  keyword: string;
  users: number | string;
}

export interface BehavioralKeyword {
  keyword: string;
  users: number;
  avgLTV: number | null;
  avgRetention: number | null;
  priorityScore: number;
  recommendation: string;
}

@Injectable()
export class SEOService {
  private readonly logger = new Logger(SEOService.name);

  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async discoverBehavioralKeywords(): Promise<BehavioralKeyword[]> {
    this.logger.debug('Discovering behavioral keywords...');

    /*
     * MySQL/MariaDB-compatible JSON extraction.
     *
     * EventType currently has no SEARCH member, so do not filter
     * by the nonexistent value 'SEARCH'.
     *
     * LTV and retention are intentionally not fabricated:
     * User has no ltv/retention_7d columns, and payment amounts
     * may use different currencies.
     */
    const rows = (await this.eventRepo.query(`
      SELECT
        JSON_UNQUOTE(
          JSON_EXTRACT(e.metadata, '$.searchQuery')
        ) AS keyword,
        COUNT(DISTINCT e.userId) AS users
      FROM user_events e
      INNER JOIN \`user\` u ON u.id = e.userId
      WHERE e.metadata IS NOT NULL
        AND JSON_EXTRACT(e.metadata, '$.searchQuery') IS NOT NULL
        AND JSON_UNQUOTE(
          JSON_EXTRACT(e.metadata, '$.searchQuery')
        ) <> ''
      GROUP BY
        JSON_UNQUOTE(
          JSON_EXTRACT(e.metadata, '$.searchQuery')
        )
      HAVING COUNT(DISTINCT e.userId) > 10
      ORDER BY users DESC
      LIMIT 50
    `)) as BehavioralKeywordRow[];

    this.logger.log(`Found ${rows.length} behavioral keywords`);

    return rows.map((row) => {
      const keyword = String(row.keyword);
      const users = Number(row.users);

      return {
        keyword,
        users,
        avgLTV: null,
        avgRetention: null,
        priorityScore: users,
        recommendation: this.generateMicroBrief(keyword, users),
      };
    });
  }

  private generateMicroBrief(keyword: string, users: number): string {
    return (
      `عبارت «${keyword}» در داده‌های ثبت‌شده ` +
      `توسط ${users} کاربر جست‌وجو شده است. ` +
      'پیشنهاد می‌شود ابتدا محتوای مرتبط با این عبارت بررسی شود.'
    );
  }
}
