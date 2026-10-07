import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { User } from '../../../users/entities/user.entity';
import { Interaction } from '../../../interaction/entities/interaction.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';

interface ContentIdea {
  title: string;
  type: string;
  keywords: string[];
  estimatedTraffic: number;
  priority: string;
  source: string;
  opportunity?: string;
}

@Injectable()
export class ContentOpportunityService {
  private readonly logger = new Logger(ContentOpportunityService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Interaction)
    private readonly interactionRepo: Repository<Interaction>,
    private readonly analyticsConnection: DataSource,

    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,
  ) {}

  async generateContentIdeas() {
    // 1. از هابی‌های پرتکرار
    const hobbyCounts = await this.getHobbyCounts();

    // 2. از شهرهای کم‌کاربر
    const underservedCities = await this.getUnderservedCities();

    // 3. از ارزش‌های موفق
    const successfulValues = await this.getSuccessfulValues();

    // 4. از کلمات کلیدی جستجو شده
    const searchKeywords = await this.getSearchKeywords();

    const ideas: ContentIdea[] = [];

    // ایده از هابی‌ها
    const topHobbies = Object.entries(hobbyCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    topHobbies.forEach(([hobby, count]) => {
      ideas.push({
        title: `چطور با ${hobby} همسر مناسب پیدا کنیم؟`,
        type: 'blog',
        keywords: [hobby, 'همسریابی', 'ازدواج'],
        estimatedTraffic: count * 100,
        priority: count > 50 ? 'high' : 'medium',
        source: 'hobby',
      });
    });

    // ایده از شهرها
    underservedCities.slice(0, 3).forEach((city) => {
      ideas.push({
        title: `همسریابی در ${city} - راهنمای کامل`,
        type: 'local_guide',
        keywords: [city, 'همسریابی', 'ازدواج'],
        estimatedTraffic: 500,
        priority: 'high',
        opportunity: 'underserved',
        source: 'city',
      });
    });

    // ایده از ارزش‌ها
    successfulValues.slice(0, 3).forEach((value) => {
      ideas.push({
        title: `چرا ${value} مهمترین ویژگی در همسریابی است؟`,
        type: 'article',
        keywords: [value, 'ازدواج موفق', 'همسر ایده‌آل'],
        estimatedTraffic: 300,
        priority: 'medium',
        source: 'value',
      });
    });

    return ideas;
  }

  private async getHobbyCounts(): Promise<Record<string, number>> {
    const users = await this.userRepo
      .createQueryBuilder('user')
      .select('user.hobbies_self')
      .getRawMany();

    const counts: Record<string, number> = {};

    users.forEach((u) => {
      try {
        const hobbies = u.user_hobbies_self;
        if (hobbies) {
          const parsed =
            typeof hobbies === 'string' ? JSON.parse(hobbies) : hobbies;
          if (Array.isArray(parsed)) {
            parsed.forEach((h) => {
              counts[h] = (counts[h] || 0) + 1;
            });
          }
        }
      } catch (e: unknown) {
        // ignore
      }
    });

    return counts;
  }

  private async getUnderservedCities(): Promise<string[]> {
    const cityDistribution = await this.userRepo
      .createQueryBuilder('user')
      .select('user.city', 'city')
      .addSelect('COUNT(*)', 'count')
      .where('user.city IS NOT NULL')
      .groupBy('user.city')
      .getRawMany();

    return cityDistribution
      .filter((c) => parseInt(c.count) < 10)
      .map((c) => c.city);
  }

  private async getSuccessfulValues(): Promise<string[]> {
    const interactions = await this.interactionRepo
      .createQueryBuilder('interaction')
      .leftJoinAndSelect('interaction.receiver', 'receiver')
      .select('receiver.values_self')
      .where('interaction.type = :type', { type: 'like' })
      .limit(100)
      .getRawMany();

    const valueCounts: Record<string, number> = {};

    interactions.forEach((i) => {
      try {
        const values = i.receiver_values_self;
        if (values) {
          const parsed =
            typeof values === 'string' ? JSON.parse(values) : values;
          if (Array.isArray(parsed)) {
            parsed.forEach((v) => {
              valueCounts[v] = (valueCounts[v] || 0) + 1;
            });
          }
        }
      } catch (e: unknown) {
        // ignore
      }
    });

    return Object.entries(valueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([value]) => value);
  }

  private async getSearchKeywords(): Promise<string[]> {
    // TODO: از Google Search Console API
    return ['همسریابی آنلاین', 'ازدواج اینترنتی', 'همدم'];
  }

  async generateHighIntentContent() {
    try {
      const highIntentKeywords = await this.analyticsConnection.query(`
        SELECT
          u.acquisitionKeyword as keyword,
          COUNT(DISTINCT u.id) as users,
          AVG(p.amount) as avg_ltv,
          SUM(p.amount) as total_revenue
        FROM user u
        LEFT JOIN payments p ON p.userId = u.id AND p.status = 'paid'
        WHERE u.acquisitionKeyword IS NOT NULL
          AND u.createdAt > DATE_SUB(NOW(), INTERVAL 90 DAY)
        GROUP BY u.acquisitionKeyword
        HAVING AVG(p.amount) > 100
          AND COUNT(DISTINCT u.id) > 5
        ORDER BY avg_ltv DESC
        LIMIT 20
      `);

      return highIntentKeywords.map((k: any) => ({
        keyword: k.keyword,
        title: this.generateTitleFromKeyword(k.keyword),
        expectedLTV: parseFloat(k.avg_ltv),
        estimatedUsers: parseInt(k.users),
        totalRevenue: parseFloat(k.total_revenue),
        priority: parseFloat(k.avg_ltv) * parseInt(k.users),
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`High intent content failed: ${message}`);
      return [];
    }
  }

  private generateTitleFromKeyword(keyword: string): string {
    const templates = [
      `راهنمای کامل ${keyword}`,
      `چطور در ${keyword} موفق باشیم؟`,
      `${keyword} - تجربه کاربران ما`,
      `بهترین راهکارها برای ${keyword}`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
}
