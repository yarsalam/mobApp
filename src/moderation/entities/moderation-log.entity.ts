import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

@Entity('moderation_logs')
export class ModerationLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  userId: number;

  // به جای متن کامل، هش نگه می‌داریم (حریم خصوصی)
  @Column({ type: 'varchar', length: 64, nullable: true })
  messageHash: string;

  // پیشوند masked برای debug محدود
  @Column({ type: 'varchar', length: 100, nullable: true })
  messagePreview: string;

  @Column()
  isSafe: boolean;

  @Column('float')
  confidence: number;

  @Column({ type: 'json' })
  flags: string[];

  @Column({ length: 20 })
  severity: string;

  @Column('float', { nullable: true })
  processingTimeMs: number;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  userAgent: string;

  @CreateDateColumn()
  createdAt: Date;
}
