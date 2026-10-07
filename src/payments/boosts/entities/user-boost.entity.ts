import { User } from 'src/users/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_boosts')
export class UserBoost {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => User, (user) => user.boost)
  @JoinColumn()
  user: User;

  @Column({ default: 0 })
  instantCount: number;

  @Column({ type: 'timestamp', nullable: true })
  monthlyUntil: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  activeUntil: Date | null;

  @Column({ default: 1 })
  strength: number;

  @Column({ default: false })
  freeGranted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
