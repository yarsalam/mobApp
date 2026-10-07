import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_credits')
export class UserCredits {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  @Index('IDX_USER_CREDITS_USER_ID')
  userId: number;

  @Column({ type: 'int', default: 0 })
  balance: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
