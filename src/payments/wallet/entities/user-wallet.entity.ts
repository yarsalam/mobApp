import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';

@Entity('user_wallets')
export class UserWallet {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => User, (user) => user.wallet)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ unique: true })
  userId: number;

  /**
   * موجودی به ریال (واحد پایه ایران)
   * مثال: 200000 = ۲۰۰,۰۰۰ ریال = ۲۰,۰۰۰ تومان
   */
  @Column({ type: 'bigint', default: 0 })
  balance: number;

  @Column({ type: 'varchar', length: 5, default: 'IRT' })
  currency: 'IRT';

  @UpdateDateColumn()
  updatedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
