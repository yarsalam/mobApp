import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_push_state')
export class UserPushState {
  @PrimaryColumn()
  user_id: number;

  @UpdateDateColumn()
  last_push_sent_at: Date;
}
