import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('feature_learning_receipts')
@Index('uq_feature_learning_event_effect', ['eventId', 'effectType'], {
  unique: true,
})
export class FeatureLearningReceipt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  eventId: number;

  @Column({ length: 40 })
  effectType: string;

  @Column({ type: 'int' })
  userId: number;

  @CreateDateColumn()
  createdAt: Date;
}
