import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { EventType } from '../type/event-type.enum';
import { User } from 'src/users/entities/user.entity';

@Entity('user_events')
@Index(['userId', 'createdAt'])
@Index(['type', 'createdAt'])
@Index(['sessionId'])
export class PartitionedEvent {
  @PrimaryGeneratedColumn()
  id: number;

  // ← Column مستقیم — این مقدار واقعی INSERT میشه
  @Column({ name: 'userId' })
  userId: number;

  @Column({ nullable: true })
  targetUserId?: number;

  @Column({
    type: 'enum',
    enum: EventType,
  })
  type: EventType;

  @Column({ nullable: true })
  sessionId?: string;

  @Column({ type: 'json', nullable: true })
  metadata?: any;

  @Column({ type: 'float', nullable: true })
  value?: number;

  @Column({ length: 10, nullable: true })
  currency?: string;

  @Column({ type: 'int', nullable: true })
  duration?: number;

  @Column({ length: 20, nullable: true })
  platform?: string;

  @Column({ length: 20, nullable: true })
  country?: string;

  // ← Relation جداگانه با insertable: false, updateable: false
  // تا TypeORM سعی نکنه از طریق relation هم بنویسه
  @ManyToOne(() => User, (user) => user.userEvents, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @CreateDateColumn()
  createdAt: Date;
}
