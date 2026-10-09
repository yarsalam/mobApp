import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('event_outbox')
@Index(['status', 'createdAt'])
@Index(['eventId'], { unique: true })
export class EventOutbox {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  eventId: number;

  @Column()
  userId: number;

  @Column({ length: 64 })
  type: string;

  @Column({ length: 20, default: 'pending' })
  status: 'pending' | 'dispatched';

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  lastError?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  dispatchedAt?: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
