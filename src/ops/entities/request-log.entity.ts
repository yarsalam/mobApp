import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('request_log')
export class RequestLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'trace_id', length: 100 })
  traceId: string;

  @Column({ length: 50, nullable: true })
  flow: string;

  @Column({ length: 100 })
  service: string;

  @Column({ length: 200 })
  action: string;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number;

  @Column({ type: 'int', nullable: true })
  status: number;

  @Column({ type: 'json', nullable: true })
  meta: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
