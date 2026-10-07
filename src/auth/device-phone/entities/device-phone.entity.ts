import { UserDevice } from 'src/user-device/entities/user-device.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DevicePhoneEvent {
  SEEN = 'seen',
  OTP_SENT = 'otp_sent',
  VERIFIED = 'verified',
  LOGIN = 'login',
}

@Entity('device_phones')
@Index(['device', 'phone'], { unique: true })
@Index(['phone'])
export class DevicePhone {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => UserDevice, { onDelete: 'CASCADE' })
  device: UserDevice;

  @Column()
  phone: string;

  @Column({
    type: 'enum',
    enum: DevicePhoneEvent,
    default: DevicePhoneEvent.SEEN,
  })
  event: DevicePhoneEvent;

  @Column({ nullable: true })
  verified?: boolean;

  @CreateDateColumn()
  firstSeenAt: Date;

  @UpdateDateColumn()
  lastSeenAt: Date;
}
