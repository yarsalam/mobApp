import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ManualPromotionRedemptionStatus = 'reserved' | 'redeemed' | 'released';

@Entity('manual_promotion_redemptions')
@Index(
  'UQ_manual_promotion_checkout',
  ['campaignId', 'userId', 'checkoutKey'],
  { unique: true },
)
@Index('IDX_manual_promotion_campaign_status', ['campaignId', 'status'])
@Index('IDX_manual_promotion_user_status', ['campaignId', 'userId', 'status'])
export class ManualPromotionRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  campaignId: string;

  @Column({ type: 'int', unsigned: true })
  userId: number;

  @Column({ length: 255 })
  bundleCode: string;

  @Column({ length: 80 })
  checkoutKey: string;

  @Column({ type: 'int', unsigned: true })
  basePriceRials: number;

  @Column({ type: 'int', unsigned: true })
  discountRials: number;

  @Column({ type: 'int', unsigned: true })
  payablePriceRials: number;

  @Column({
    type: 'enum',
    enum: ['reserved', 'redeemed', 'released'],
    default: 'reserved',
  })
  status: ManualPromotionRedemptionStatus;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  redeemedAt: Date | null;
}
