import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum NotificationType {
  MESSAGE = 'message',
  VISITOR = 'visitor',
  LIKE = 'like',
  SUPERLIKE = 'superlike',
  MATCH = 'match',
  SYSTEM = 'system',
  PAYMENT = 'payment',
  VIP = 'vip',
  VERIFICATION = 'verification',
  TICKET = 'ticket',
  SECURITY = 'security',
}

export const INTERACTION_TYPES = [
  NotificationType.VISITOR,
  NotificationType.LIKE,
  NotificationType.SUPERLIKE,
  NotificationType.MATCH,
];

export const SYSTEM_TYPES = [
  NotificationType.SYSTEM,
  NotificationType.PAYMENT,
  NotificationType.VIP,
  NotificationType.VERIFICATION,
  NotificationType.TICKET,
  NotificationType.SECURITY,
];

@Entity('notifications')
@Index(['user_id', 'is_read'])
export class AppNotification {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  user_id: number;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column()
  message: string;

  @Column({ default: false })
  delivered: boolean;

  @Column({ default: false })
  clicked: boolean;

  @Column({ type: 'timestamp', nullable: true })
  last_push_sent_at: Date | null;

  @Column({ default: false })
  is_read: boolean;

  @Column({ nullable: true })
  related_id: number;

  @CreateDateColumn()
  created_at: Date;
}
