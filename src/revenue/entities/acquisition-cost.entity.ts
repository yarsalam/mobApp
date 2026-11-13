import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const ACQUISITION_COST_CURRENCIES = ['IRT', 'USDT', 'BTC', 'USD'] as const;
export type AcquisitionCostCurrency = (typeof ACQUISITION_COST_CURRENCIES)[number];

export const ACQUISITION_COST_CATEGORIES = [
  'media',
  'content',
  'labor',
  'agency',
  'tools',
  'other',
] as const;
export type AcquisitionCostCategory = (typeof ACQUISITION_COST_CATEGORIES)[number];

@Entity('acquisition_costs')
@Index('idx_acquisition_cost_source_date', ['source', 'occurredAt'])
@Index('idx_acquisition_cost_campaign_date', ['campaignId', 'occurredAt'])
@Index('uq_acquisition_cost_idempotency', ['idempotencyKey'], { unique: true })
export class AcquisitionCost {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 80 })
  source!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  medium?: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  campaign?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  campaignId?: string | null;

  @Column({
    type: 'enum',
    enum: ACQUISITION_COST_CATEGORIES,
    default: 'media',
  })
  category!: AcquisitionCostCategory;

  // A zero-cost row is an explicit statement. No row means cost is unknown.
  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount!: string;

  @Column({
    type: 'enum',
    enum: ACQUISITION_COST_CURRENCIES,
    default: 'IRT',
  })
  currency!: AcquisitionCostCurrency;

  @Column({ type: 'timestamp' })
  occurredAt!: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  createdBy?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotencyKey?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
