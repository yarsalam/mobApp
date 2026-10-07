import { AiFeedback } from 'src/ai-feedback/entities/ai-feedback.entity';
import { Interaction } from 'src/interaction/entities/interaction.entity';
import { Message } from 'src/message/entities/message.entity';
import { UserBoost } from 'src/payments/boosts/entities/user-boost.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { UserWallet } from 'src/payments/wallet/entities/user-wallet.entity';
import { ProfileVisitor } from 'src/profile-visitors/entities/profile-visitor.entity';
import { UserDevice } from 'src/user-device/entities/user-device.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { UserPhone } from 'src/user-phones/entities/user-phone.entity';
import { UserImage } from 'src/user_images/entities/user_image.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
@Index(['status'])
@Index(['gender', 'status'])
@Index(['city', 'gender', 'status'])
@Index(['createdAt'])
@Index(['isFaceVerified', 'status'])
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: true })
  nickname: string;

  @Column({ unique: true })
  phone: string = '';

  @Column({ nullable: true })
  status?: 'active' | 'suspended' | 'resigned' | 'admin_blocked';

  @Column({ nullable: true })
  gender: string;

  @Column({ default: false })
  isCompleted: boolean;

  // تاریخ تولد
  @Column({ nullable: true })
  birth_day?: string;

  @Column({ nullable: true })
  birth_month?: string;

  @Column({ nullable: true })
  birth_year?: string;

  // وضعیت تاهل
  @Column({ nullable: true })
  marital?: string;

  // محل زندگی
  @Column({ nullable: true })
  province?: string;

  @Column({ nullable: true })
  city?: string;

  // ملیت
  @Column({ nullable: true })
  nationality?: string;

  // تحصیلات و شغل
  @Column({ nullable: true })
  education?: string;

  @Column({ nullable: true })
  employment?: string;

  // مشخصات ظاهری
  @Column({ nullable: true })
  height?: string;

  @Column({ nullable: true })
  weight?: string;

  @Column({ nullable: true })
  health?: string;

  // باورها و سبک زندگی
  @Column({ nullable: true })
  religion?: string;

  // درباره خودم
  @Column({ type: 'text', nullable: true })
  aboutme?: string;

  // درباره همسر ایده‌آل
  @Column({ type: 'text', nullable: true })
  partner_about?: string;

  @Column({ type: 'json', nullable: true })
  hobbies_self?: string[];

  @Column({ type: 'json', nullable: true })
  values_self?: string[];

  @Column({ type: 'json', nullable: true })
  hobbies_partner?: string[];

  @Column({ type: 'json', nullable: true })
  values_partner?: string[];

  // امنیت
  @Column({ nullable: true })
  password?: string;

  // رابطه با تصاویر
  @OneToMany(() => UserImage, (userImage) => userImage.user)
  userImages?: UserImage[];

  @OneToMany(() => PartitionedEvent, (event) => event.user)
  userEvents: PartitionedEvent[];

  // کاربرانی که پروفایل این کاربر را بازدید کرده‌اند
  @OneToMany(() => ProfileVisitor, (profileVisitor) => profileVisitor.profile)
  profileVisitors: ProfileVisitor[];

  // پروفایل‌هایی که این کاربر بازدید کرده است
  @OneToMany(() => ProfileVisitor, (profileVisitor) => profileVisitor.visitor)
  visitedProfiles: ProfileVisitor[];

  @OneToMany(() => Message, (message) => message.from)
  sentMessages: Message[];

  @OneToMany(() => Message, (message) => message.to)
  receivedMessages: Message[];

  @OneToMany(() => UserDevice, (device) => device.user)
  devices: UserDevice[];

  @OneToMany(() => UserPhone, (userPhone) => userPhone.user)
  phones: UserPhone[];

  @OneToMany(() => Interaction, (i) => i.sender)
  interactionsSent: Interaction[];

  @OneToMany(() => Interaction, (i) => i.receiver)
  interactionsReceived: Interaction[];

  @OneToOne(() => UserBoost, (b) => b.user)
  boost: UserBoost;

  @Column({ default: 'A' })
  experimentGroup: 'A' | 'B';

  @OneToMany(() => Payment, (payment) => payment.user)
  payments: Payment[];

  @OneToMany(() => AiFeedback, (f) => f.user)
  aiFeedbacks: AiFeedback[];

  @Column({ default: true })
  canSendMessage: boolean;

  @Column({ type: 'timestamp', nullable: true })
  restrictedUntil?: Date;

  @Column({ type: 'int', default: 50 })
  trustScore: number;

  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'timestamp', nullable: true })
  blockedAt?: Date;

  @Column({ nullable: true })
  blockReason?: string;

  @Column({ default: false })
  isFaceVerified: boolean;

  @Column({ type: 'timestamp', nullable: true })
  faceVerifiedAt?: Date;

  @Column({ default: 'cold' })
  phase: 'cold' | 'warm' | 'hot';

  @Column({
    type: 'enum',
    enum: ['free', 'premium', 'gold', 'vip'],
    default: 'free',
  })
  tier: 'free' | 'premium' | 'gold' | 'vip';

  @Column({ nullable: true })
  acquisitionKeyword?: string;

  @OneToOne(() => UserWallet, (wallet) => wallet.user)
  wallet: UserWallet;

  @Column({ nullable: true })
  acquisitionSource?: string; // 'instagram', 'telegram', 'whatsapp', 'google', 'referral', 'direct', etc.

  @Column({ default: false })
  isVerified: boolean;

  @UpdateDateColumn({ nullable: true })
  lastActive?: Date;

  // زمان‌ها
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
