import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';

@Entity()
@Index(['deviceId'])
@Index(['user', 'deviceId'], { unique: true })
@Index(['user', 'pushEnabled'])
export class UserDevice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  platform?: 'web' | 'mobile';

  @Column({ nullable: true })
  deviceType?: string;

  @Column({ nullable: true })
  os?: string;

  @Column({ nullable: true })
  browser?: string;

  @Column({ nullable: true })
  brand?: string;

  @Column({ nullable: true })
  ipAddress?: string;

  @Column({ nullable: true })
  country?: string;

  @Column({ nullable: true })
  city?: string;

  @Column({ nullable: true })
  timezone?: string;

  @Column({ default: false })
  isVPN?: boolean;

  @Column({ nullable: true })
  deviceId?: string;

  // FCM registration tokens are never returned from ordinary entity reads.
  @Column({ type: 'varchar', length: 2048, nullable: true, select: false })
  pushToken?: string | null;

  @Column({ default: false })
  pushEnabled: boolean;

  @Column({ default: false })
  isOnline: boolean;

  @Column({ nullable: true })
  model?: string;

  @Column({ nullable: true })
  osVersion?: string;

  @Column({ nullable: true })
  appVersion?: string;

  @ManyToOne(() => User, (user) => user.devices, { onDelete: 'CASCADE' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
