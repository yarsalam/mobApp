import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';

@Entity('profile_visitors')
@Index(['visitorId', 'profileId'], { unique: true }) // ← هر زوج فقط یه رکورد
@Index(['profileId', 'visitedAt'])
@Index(['profileId', 'isMutual'])
export class ProfileVisitor {
  @PrimaryGeneratedColumn()
  id: number;

  // ─── بازدیدکننده ──────────────────────────────────────────────────────────
  @Column()
  visitorId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'visitorId' })
  visitor: User;

  // ─── پروفایل بازدیدشده ────────────────────────────────────────────────────
  @Column()
  profileId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'profileId' })
  profile: User;

  // ─── فیلدها ───────────────────────────────────────────────────────────────
  @Column({ type: 'timestamp' })
  visitedAt: Date; // ← آخرین بازدید (update می‌شه)

  @Column({ type: 'int', default: 1 })
  visitCount: number; // ← تعداد کل بازدیدها (increment می‌شه)

  @Column({ type: 'timestamp', nullable: true })
  readAt: Date | null; // ← کِی صاحب پروفایل دیده

  @Column({ type: 'int', default: 0 })
  viewDuration: number;

  @Column({ type: 'boolean', default: false })
  isMutual: boolean;

  @Column({ type: 'json', nullable: true })
  metadata?: {
    source: string;
    deviceType: string;
    previousAction?: string;
  };

  @CreateDateColumn()
  createdAt: Date; // ← اولین بازدید
}
