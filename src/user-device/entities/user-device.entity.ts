import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';

import { Index } from 'typeorm';

@Entity()
@Index(['deviceId'])
@Index(['user', 'deviceId'], { unique: true })
export class UserDevice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  platform?: 'web' | 'mobile';

  @Column({ nullable: true })
  deviceType?: string; // desktop / mobile / tablet

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
