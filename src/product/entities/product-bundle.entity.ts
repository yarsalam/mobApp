import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('product_bundles')
export class ProductBundle {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  code: string;

  @Column('json')
  items: Array<{
    type: 'credits' | 'boost' | 'vip';
    amount: number;
    durationDays?: number;
  }>;

  @Column()
  price: number;

  @Column({ default: true })
  active: boolean;
}
