import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('user_daily_metrics')
@Index(['userId', 'metricDate'], { unique: true })
export class UserDailyMetrics {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'date' })
  metricDate: string;

  @Column({ type: 'int', default: 0 })
  appOpens: number;

  @Column({ type: 'int', default: 0 })
  messagesSent: number;

  @Column({ type: 'int', default: 0 })
  profileViews: number;

  @Column({ type: 'int', default: 0 })
  likes: number;

  @Column({ type: 'int', default: 0 })
  matches: number;

  @Column({ type: 'int', default: 0 })
  boostUsed: number;

  @Column({ type: 'int', default: 0 })
  purchases: number;
}
