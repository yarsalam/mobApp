import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';

export type InteractionType =
  | 'view'
  | 'like'
  | 'superlike'
  | 'skip'
  | 'message'
  | 'match';

@Entity()
@Index(['sender', 'receiver'])
@Index(['sender', 'receiver', 'type'])
@Index(['receiver'])
export class Interaction {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, (user) => user.interactionsSent, {
    onDelete: 'CASCADE',
  })
  sender: User;

  @ManyToOne(() => User, (user) => user.interactionsReceived, {
    onDelete: 'CASCADE',
  })
  receiver: User;

  @Column({ type: 'varchar', length: 20 })
  type: InteractionType;

  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
