import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum ReportStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
  ACTIONTAKEN = 'action_taken',
}

@Entity('reports')
@Index(['status', 'createdAt'])
export class Report {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  reporter: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  reportedUser: User;

  @Column({
    type: 'enum',
    enum: [
      'abuse',
      'spam',
      'fake',
      'inappropriate_message',
      'harassment',
      'other',
    ],
  })
  reason: string;

  @Column({ type: 'text', nullable: true })
  message?: string;

  @Column({ nullable: true })
  messageId?: string;

  @Column({
    type: 'enum',
    enum: ReportStatus,
    default: ReportStatus.PENDING,
  })
  status: ReportStatus;

  @Column({ type: 'boolean', default: false })
  confirmed: boolean;

  @Column({ nullable: true })
  confirmedBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
