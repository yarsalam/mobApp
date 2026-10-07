import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RecommendationPriority {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum RecommendationStatus {
  PENDING = 'pending',
  IMPLEMENTED = 'implemented',
  REJECTED = 'rejected',
}

@Entity('seo_recommendations')
export class SEORecommendation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: RecommendationPriority })
  priority: RecommendationPriority;

  @Column({
    type: 'enum',
    enum: RecommendationStatus,
    default: RecommendationStatus.PENDING,
  })
  status: RecommendationStatus;

  @Column({ type: 'float', nullable: true })
  estimatedImpact: number;

  @Column({ type: 'float', nullable: true })
  actualImpact: number;

  @Column({ type: 'json', nullable: true })
  metrics: Record<string, any>;

  @Column({ type: 'timestamp', nullable: true })
  implementedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
