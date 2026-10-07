import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('ai_image')
export class AiImage {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  userId: number;

  @Column()
  url: string;

  @Column({ nullable: true })
  path: string; // مسیر فایل روی دیسک — برای Processor

  @Column({ nullable: true })
  filename: string; // نام فایل اصلی

  @Column({ nullable: true })
  size: string;

  @Column({ type: 'float', nullable: true })
  qualityScore?: number;

  @Column({ type: 'float', nullable: true })
  engagementImpact?: number;

  @CreateDateColumn()
  createdAt: Date;
}
