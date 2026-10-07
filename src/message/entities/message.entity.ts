import { User } from 'src/users/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('messages')
@Index(['from_id', 'created_at'])
@Index(['to_id', 'created_at'])
@Index(['from_id', 'to_id'])
@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  from_id: number;

  @Column()
  to_id: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ default: true })
  is_free: boolean;

  @Column({
    type: 'enum',
    enum: ['pending', 'approved', 'flagged', 'rejected'],
    default: 'pending',
  })
  moderationStatus: string;

  @Column({ type: 'boolean', default: false })
  deleted_from: boolean;

  @Column({ type: 'boolean', default: false })
  deleted_to: boolean;

  @Column({ type: 'timestamp', nullable: true })
  read_at?: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => User, (user) => user.sentMessages)
  @JoinColumn({ name: 'from_id' })
  from: User;

  @ManyToOne(() => User, (user) => user.receivedMessages)
  @JoinColumn({ name: 'to_id' })
  to: User;
}
