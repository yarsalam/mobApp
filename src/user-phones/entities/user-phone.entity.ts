import { User } from 'src/users/entities/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_phones')
export class UserPhone {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, (user) => user.phones, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  phone: string;

  // آیا این شماره تأیید (کد SMS) شده؟
  @Column({ default: false })
  isVerified: boolean;

  // آیا این شماره الان شماره فعال کاربر هست؟
  @Column({ default: false })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  verifiedAt: Date;
}
