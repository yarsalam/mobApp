import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('competitor_data')
@Index(['domain', 'date'])
export class CompetitorData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200 })
  name: string;

  @Column({ length: 500 })
  domain: string;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'json' })
  traffic: {
    monthlyVisits: number;
    trafficSources: Record<string, number>;
    topKeywords: Array<{ keyword: string; position: number; traffic: number }>;
  };

  @Column({ type: 'json' })
  backlinks: {
    total: number;
    referringDomains: number;
    newLinks: number;
    lostLinks: number;
  };

  @Column({ type: 'json' })
  social: {
    instagram?: { followers: number; growth: number };
    telegram?: { members: number; growth: number };
    linkedin?: { followers: number; growth: number };
  };

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
