import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { SupportTicket } from './ticket.entity';
import { User } from '../../users/entities/user.entity';

export enum MessageType {
  USER = 'user',
  SUPPORT = 'support',
  AI = 'ai',
  SYSTEM = 'system',
}

@Entity('ticket_messages')
export class TicketMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => SupportTicket, (ticket) => ticket.messages, {
    onDelete: 'CASCADE',
  })
  ticket: SupportTicket | null;

  @ManyToOne(() => User, { nullable: true })
  sender: User;

  @Column({ type: 'enum', enum: MessageType, default: MessageType.USER })
  type: MessageType;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'json', nullable: true })
  attachments: {
    url: string;
    type: string;
    name: string;
  }[];

  @Column({ type: 'boolean', default: false })
  isAIGenerated: boolean;

  @Column({ type: 'float', nullable: true })
  aiConfidence: number;

  @CreateDateColumn()
  createdAt: Date;
}
