import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('seo_metrics')
@Index(['metricDate', 'type'])
export class SEOMetrics {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  metricDate: Date;

  @Column({ length: 50 })
  type: string; // 'technical', 'user', 'campaign', 'competitor'

  @Column({ type: 'json' })
  data: Record<string, any>;

  @Column({ type: 'float', nullable: true })
  score: number;

  @Column({ type: 'float', nullable: true })
  ltv: number; // Lifetime Value

  @Column({ type: 'float', nullable: true })
  cac: number; // Customer Acquisition Cost

  @Column({ type: 'float', nullable: true })
  paybackPeriod: number; // ماه

  @Column({ type: 'json', nullable: true })
  revenueAttribution: {
    organic: number;
    paid: number;
    social: number;
    referral: number;
  };

  @Column({ type: 'float', nullable: true })
  revenuePerUser: number;

  @Column({ type: 'float', nullable: true })
  seoROI: number;

  @CreateDateColumn()
  createdAt: Date;
}
