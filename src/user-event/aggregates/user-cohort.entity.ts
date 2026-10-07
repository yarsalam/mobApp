import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('user_cohorts')
export class UserCohort {
  @PrimaryColumn({ type: 'date' })
  cohortDate: Date;

  @PrimaryColumn({ type: 'int' })
  day: number;

  @Column({ type: 'int' })
  totalUsers: number;

  @Column({ type: 'int' })
  retainedUsers: number;

  @Column({ type: 'float' })
  retentionRate: number;

  @Column({ type: 'jsonb', nullable: true })
  segments?: Record<string, number>; // retention by segment
}
