import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { AssistantConversation } from './assistant-conversation.entity';

@Entity()
export class AssistantMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => AssistantConversation, (conv) => conv.messages, {
    onDelete: 'CASCADE',
  })
  conversation: AssistantConversation;

  @Column()
  sender: 'user' | 'assistant' | 'system';

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'json', nullable: true })
  meta?: any;

  @CreateDateColumn() createdAt: Date;
}
