import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { EventType } from '../type/event-type.enum';

@Entity('daily_event_aggregates')
export class DailyEventAggregate {
  @PrimaryColumn({ type: 'date' })
  date: Date;

  @PrimaryColumn({ type: 'varchar', length: 60 })
  eventType: EventType;

  @Column({ type: 'int', default: 0 })
  totalCount: number;

  @Column({ type: 'int', default: 0 })
  uniqueUsers: number;

  @Column({ type: 'float', default: 0 })
  totalValue: number;

  @Column({ type: 'jsonb', nullable: true })
  byPlatform?: Record<string, number>;

  @Column({ type: 'jsonb', nullable: true })
  byCountry?: Record<string, number>;

  @UpdateDateColumn()
  updatedAt: Date;
}
