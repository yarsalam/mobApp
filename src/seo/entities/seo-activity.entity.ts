import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ActivityType {
  SOCIAL_POST = 'social_post',
  BLOG = 'blog',
  GUEST_POST = 'guest_post',
  BACKLINK = 'backlink',
  AD = 'ad',
  BOT = 'bot',
  RAPOR = 'rapor',
  CONTENT = 'content',
}

export enum ActivityPlatform {
  INSTAGRAM = 'instagram',
  TELEGRAM = 'telegram',
  LINKEDIN = 'linkedin',
  MEDIUM = 'medium',
  QUORA = 'quora',
  GOOGLE_ADS = 'google_ads',
  OTHER = 'other',
}

@Entity('seo_activities')
export class SEOActivity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: ActivityType })
  type: ActivityType;

  @Column({ type: 'enum', enum: ActivityPlatform })
  platform: ActivityPlatform;

  @Column({ nullable: true })
  url: string;

  @Column({ type: 'text', nullable: true })
  content: string;

  @Column({ type: 'json', nullable: true })
  targetAudience: {
    cities?: string[];
    ages?: [number, number];
    interests?: string[];
  };

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  cost: number;

  // ✅ اصلاح شده
  @Column({
    type: 'json',
    nullable: false,
  })
  results: {
    clicks: number;
    impressions: number;
    registrations: number;
    conversions: number;
    revenue: number;
  };

  @Column({ type: 'float', nullable: true })
  aiScore: number;

  @Column({ type: 'float', nullable: true })
  roi: number;

  @Column({ type: 'timestamp' })
  performedAt: Date;

  @Column({ nullable: true })
  performedBy: string;

  @Column({ type: 'float', nullable: true })
  ltvGenerated: number; // LTV ایجاد شده توسط این فعالیت

  @Column({ type: 'float', nullable: true })
  cacReduction: number; // کاهش CAC

  @Column({ type: 'json', nullable: true })
  revenueBreakdown: {
    direct: number;
    indirect: number;
    assisted: number;
  };

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
