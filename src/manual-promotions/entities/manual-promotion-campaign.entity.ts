import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ManualPromotionDiscountType = 'percent' | 'fixed';
export type ManualPromotionAudienceType = 'all' | 'users' | 'phases';

@Entity('manual_promotion_campaigns')
export class ManualPromotionCampaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name: string;

  @Column({ length: 120 })
  title: string;

  @Column({ length: 280 })
  subtitle: string;

  @Column({ length: 60, default: 'مشاهده پیشنهاد' })
  ctaText: string;

  @Column({ length: 255 })
  bundleCode: string;

  @Column({ type: 'enum', enum: ['percent', 'fixed'] })
  discountType: ManualPromotionDiscountType;

  @Column({ type: 'int', unsigned: true })
  discountValue: number;

  @Column({ type: 'enum', enum: ['all', 'users', 'phases'] })
  audienceType: ManualPromotionAudienceType;

  @Column({ type: 'json', nullable: true })
  audienceUserIds: number[] | null;

  @Column({ type: 'json', nullable: true })
  audiencePhases: string[] | null;

  @Column({ type: 'datetime' })
  startsAt: Date;

  @Column({ type: 'datetime' })
  endsAt: Date;

  @Column({ type: 'int', unsigned: true, nullable: true })
  maxRedemptions: number | null;

  @Column({ type: 'int', unsigned: true, default: 1 })
  perUserLimit: number;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ type: 'boolean', default: false })
  active: boolean;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}
