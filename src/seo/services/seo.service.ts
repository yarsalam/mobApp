import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';

@Injectable()
export class SEOService {
  private readonly logger = new Logger(SEOService.name);

  constructor(
    @InjectRepository(PartitionedEvent)
    private readonly eventRepo: Repository<PartitionedEvent>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async discoverBehavioralKeywords() {
    this.logger.debug('Discovering behavioral keywords...');

    // از رفتار کاربران کلمات کلیدی جدید پیدا کن
    const patterns = await this.eventRepo.query(`
      SELECT 
        e.metadata->>'searchQuery' as keyword,
        COUNT(DISTINCT e.userId) as users,
        AVG(u.ltv) as avg_ltv,
        AVG(u.retention_7d) as avg_retention
      FROM user_events e
      JOIN user u ON u.id = e.userId
      LEFT JOIN payments p ON p.user_id = u.id AND p.status = 'paid'
      WHERE e.type = 'SEARCH' 
        AND e.metadata->>'searchQuery' IS NOT NULL
        AND u.ltv > 0
      GROUP BY e.metadata->>'searchQuery'
      HAVING COUNT(DISTINCT e.userId) > 10
      ORDER BY avg_ltv DESC
      LIMIT 50
    `);

    this.logger.log(`Found ${patterns.length} behavioral keywords`);

    return patterns.map((p) => ({
      keyword: p.keyword,
      users: parseInt(p.users),
      avgLTV: parseFloat(p.avg_ltv),
      avgRetention: parseFloat(p.avg_retention),
      priorityScore: parseFloat(p.avg_ltv) * parseFloat(p.avg_retention),
      recommendation: this.generateMicroBrief(p), // تولید Micro-brief
    }));
  }

  private generateMicroBrief(pattern: any): string {
    if (pattern.avg_ltv > 200) {
      return `🚀 کاربران جستجوکننده "${pattern.keyword}" LTV بالایی دارند. پیشنهاد می‌شود محتوای اختصاصی و کمپین هدفمند برای این کلمه کلیدی ایجاد شود.`;
    }
    return `📊 "${pattern.keyword}" پتانسیل رشد دارد. با تولید محتوای بیشتر می‌توانید سهم بازار را افزایش دهید.`;
  }
}
