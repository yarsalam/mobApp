import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  UpdateDateColumn,
} from 'typeorm';

@Entity('personalities')
export class Personality {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  userId: number;

  // ستون‌های مستقل به جای JSON — برای Query و Analytics بهتر
  @Column({ type: 'float', nullable: true })
  openness?: number;

  @Column({ type: 'float', nullable: true })
  conscientiousness?: number;

  @Column({ type: 'float', nullable: true })
  extraversion?: number;

  @Column({ type: 'float', nullable: true })
  agreeableness?: number;

  @Column({ type: 'float', nullable: true })
  neuroticism?: number;

  // برای backward compatibility تا مهاجرت کامل
  @Column({ type: 'json', nullable: true })
  ocean?: Record<string, number>;

  @Column({ nullable: true })
  sentiment?: string;

  @Column({ nullable: true })
  emotion?: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
