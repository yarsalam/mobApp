import { User } from 'src/users/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentMethod =
  'manual_card' | 'crypto_usdt' | 'crypto_btc' | 'gateway';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';

export type PaymentCurrency = 'IRT' | 'USDT' | 'BTC' | 'USD';

@Entity('payments')
@Index(['userId', 'status'])
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  productId?: string;

  @Column({ nullable: true })
  productType?: string;

  @Column()
  userId: number;

  @Column()
  productCode: string;

  /**
   * مبلغ به کوچکترین واحد:
   *   IRT  → ریال
   *   USDT → سنت (500 = 5.00 USDT)
   *   BTC  → ساتوشی
   */
  @Column({ type: 'bigint' })
  amount: number;

  @Column({ type: 'varchar', length: 10 })
  currency: PaymentCurrency;

  @Column({ type: 'varchar', length: 20 })
  method: PaymentMethod;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: PaymentStatus;

  /** آدرس wallet که به کاربر نشان داده شد (crypto) */
  @Column({ nullable: true })
  walletAddress?: string;

  /** شبکه: TRC20 / TON / ERC20 */
  @Column({ nullable: true })
  network?: string;

  /** hash تراکنش روی blockchain */
  @Column({ nullable: true, unique: true })
  txHash?: string;

  /** URL رسید برای card_to_card */
  @Column({ nullable: true })
  proofUrl?: string;

  /** شناسه خارجی (درگاه / blockchain explorer) */
  @Column({ nullable: true })
  externalId?: string;

  /** زمان تأیید نهایی */
  @Column({ type: 'timestamp', nullable: true })
  confirmedAt?: Date;

  /** زمان انقضا (کاربر فرصت دارد تا این موقع پرداخت کند) */
  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;

  /** داده‌های اضافه (شماره کارت مقصد، block number و ...) */
  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, any>;

  @ManyToOne(() => User, (user) => user.payments)
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
