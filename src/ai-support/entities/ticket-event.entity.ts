import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum TicketEventType {
  CREATED = 'created',
  ASSIGNED = 'assigned',
  AI_ANALYZED = 'ai_analyzed',
  USER_REPLIED = 'user_replied',
  AGENT_REPLIED = 'agent_replied',
  AI_REPLIED = 'ai_replied',
  ESCALATED = 'escalated',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
  SLA_BREACHED = 'sla_breached',
  FEEDBACK_RECEIVED = 'feedback_received',
  PRIORITY_CHANGED = 'priority_changed',
  CATEGORY_CHANGED = 'category_changed',
}

@Entity('ticket_events')
export class TicketEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  ticketId: number;

  @Column({ type: 'enum', enum: TicketEventType })
  type: TicketEventType;

  @Column({ type: 'json', nullable: true })
  meta: Record<string, any>;

  @Column({ nullable: true })
  actorId: number;

  @CreateDateColumn()
  createdAt: Date;
}
