import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('feature_weight_states')
export class FeatureWeightState {
  @PrimaryColumn({ length: 100 })
  key: string;

  @Column({ type: 'json' })
  weights: number[];

  @UpdateDateColumn()
  updatedAt: Date;
}
