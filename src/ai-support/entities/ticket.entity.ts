import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { TicketMessage } from './ticket-message.entity';

export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
  ESCALATED = 'escalated',
}

export enum TicketPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum TicketCategory {
  TECHNICAL = 'technical',
  BILLING = 'billing',
  ACCOUNT = 'account',
  FEATURE_REQUEST = 'feature_request',
  REPORT = 'report',
  OTHER = 'other',
}

@Entity('support_tickets')
export class SupportTicket {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToMany(() => TicketMessage, (message) => message.ticket, {
    cascade: true,
  })
  messages: TicketMessage[];

  @ManyToOne(() => User, { eager: true })
  user: User;

  @Column({ nullable: true })
  assignedToId: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: TicketCategory, default: TicketCategory.OTHER })
  category: TicketCategory;

  @Column({
    type: 'enum',
    enum: TicketPriority,
    default: TicketPriority.MEDIUM,
  })
  priority: TicketPriority;

  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.OPEN })
  status: TicketStatus;

  @Column({ type: 'json', nullable: true })
  metadata: {
    userAgent?: string;
    platform?: string;
    appVersion?: string;
    screenShots?: string[];
  };

  @Column({ type: 'float', nullable: true })
  aiConfidenceScore: number;

  @Column({ type: 'json', nullable: true })
  aiSuggestions: {
    suggestedCategory: string;
    suggestedPriority: string;
    similarTickets: number[];
    estimatedResolutionTime: number;
    autoResponse?: string;
  };

  @Column({ type: 'json', nullable: true })
  sentimentAnalysis: {
    score: number;
    label: 'positive' | 'negative' | 'neutral';
    emotions: string[];
    urgencyScore: number;
  };

  @Column({ type: 'simple-array', nullable: true })
  keywords: string[];

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date;

  @Column({ type: 'int', default: 0 })
  satisfactionScore: number;

  @Column({ type: 'timestamp', nullable: true })
  firstResponseAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  slaDeadline: Date;

  @Column({ type: 'boolean', default: false })
  slaBreached: boolean;

  @Column({ type: 'timestamp', nullable: true })
  assignedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
