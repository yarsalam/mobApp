import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';

@Entity('user_images') // نام جدول جدید
export class UserImage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  filename: string; // نام فایل اصلی تصویر

  @Column({ type: 'varchar', length: 255 })
  path: string; // مسیر کامل فایل در سرور

  @Column({ type: 'varchar', length: 255 })
  url: string; // URL عمومی که برای دسترسی به تصویر استفاده می‌شود

  @Column({ type: 'boolean', default: false })
  approved: boolean; // تایید شده بودن تصویر یا خیر

  @ManyToOne(() => User, (user) => user.userImages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'boolean', default: false })
  isMain: boolean;

  @Column({ default: 0 })
  views: number;

  @Column({ default: 0 })
  likes: number;

  @Column({ type: 'float', nullable: true })
  engagementScore?: number;

  @Column({ type: 'int', nullable: true })
  faceCount?: number;

  @Column({ type: 'float', nullable: true })
  smileScore?: number;

  @Column({
    type: 'enum',
    enum: ['pending', 'approved', 'flagged', 'rejected'],
    default: 'pending',
  })
  moderationStatus: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;
}
