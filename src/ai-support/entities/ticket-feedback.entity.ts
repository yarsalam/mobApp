import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { SupportTicket } from './ticket.entity';
import { User } from '../../users/entities/user.entity';

@Entity('ticket_feedback')
export class TicketFeedback {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => SupportTicket)
  ticket: SupportTicket;

  @ManyToOne(() => User)
  user: User;

  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column({ type: 'boolean', default: false })
  resolved: boolean;

  @Column({ type: 'int', nullable: true })
  resolutionTime?: number | null;

  @Column({ type: 'json', nullable: true })
  aiEvaluation: {
    predictedSatisfaction: number;
    actualVsPredicted: number;
    learningSignal: number;
  };

  @CreateDateColumn()
  createdAt: Date;
}
