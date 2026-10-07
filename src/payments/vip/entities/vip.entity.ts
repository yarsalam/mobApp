import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_vips')
@Index(['userId', 'active'])
export class UserVip {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  userId: number;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
