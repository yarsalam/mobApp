import { User } from 'src/users/entities/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export interface FeedbackValue {
  score?: number;
  reason?: string;
  variant?: string;
  promotionId?: string;
  conversionProbability?: number;
}

export interface FeedbackContext {
  device?: string;
  platform?: string;
  sessionId?: string;
  [key: string]: any;
}

@Entity('ai_feedback')
export class AiFeedback {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  userId: number;

  @ManyToOne(() => User, (user) => user.aiFeedbacks)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 50 })
  feature: string;

  @Column({ type: 'smallint', nullable: true })
  phase?: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  feedbackType?: string;

  @Column({ type: 'float', nullable: true })
  impactScore?: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  source?: string;

  @Column({ type: 'json', nullable: true })
  value?: FeedbackValue;

  @Column({ type: 'json', nullable: true })
  context?: FeedbackContext;

  @Column({ type: 'boolean', default: false })
  convertedToPurchase?: boolean;

  @Column({ type: 'float', nullable: true })
  conversionProbability?: number;

  @Column({ type: 'int', nullable: true })
  timeToConversion?: number;

  @Column({ type: 'json', nullable: true })
  purchaseMetadata?: {
    productId?: string;
    productType?: string;
    amount?: number;
    paymentMethod?: string;
  };

  @Column({ type: 'float', nullable: true })
  ltvImpact?: number;

  @CreateDateColumn()
  createdAt: Date;
}
