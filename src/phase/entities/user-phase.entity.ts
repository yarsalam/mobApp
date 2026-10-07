import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('user_phase')
export class UserPhase {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'enum', enum: ['cold', 'warm', 'hot'], default: 'cold' })
  phase: string;

  @Column({ type: 'float', default: 0 })
  score: number;

  @Column({ type: 'boolean', default: false })
  everPaid: boolean;

  @Column({ type: 'float', default: 0 })
  learningScore: number;

  @Column({ type: 'timestamp', nullable: true })
  lastWeightUpdate?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
