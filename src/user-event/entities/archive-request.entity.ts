import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ArchiveStatus {
  PENDING = 'pending', // منتظر تأیید ادمین
  APPROVED = 'approved', // تأیید شده
  REJECTED = 'rejected', // رد شده
  PROCESSING = 'processing', // در حال آرشیو
  COMPLETED = 'completed', // آرشیو شد
  FAILED = 'failed', // خطا
}

@Entity('archive_requests')
@Index(['status', 'createdAt'])
export class ArchiveRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: ArchiveStatus, default: ArchiveStatus.PENDING })
  status: ArchiveStatus;

  @Column({ length: 100 })
  tableName: string;

  @Column({ type: 'date' })
  olderThan: Date; // داده‌های قبل از این تاریخ

  @Column({ type: 'bigint' })
  estimatedRows: number; // تعداد تخمینی رکوردها

  @Column({ type: 'float' })
  estimatedSizeMb: number; // حجم تخمینی (مگابایت)

  @Column({ type: 'float' })
  estimatedSavingsUsd: number; // صرفه‌جویی تخمینی (دلار)

  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, any>;

  @Column({ nullable: true })
  approvedBy?: string; // ادمینی که تأیید کرده

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  archivedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
