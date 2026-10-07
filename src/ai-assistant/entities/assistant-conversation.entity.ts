import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { AssistantMessage } from './assistant-message.entity';

@Entity()
export class AssistantConversation {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ default: 'open' })
  status: 'open' | 'closed' | 'archived';

  @Column({ type: 'json', nullable: true })
  metadata?: any;

  @OneToMany(() => AssistantMessage, (m) => m.conversation, { cascade: true })
  messages: AssistantMessage[];

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
