import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  Unique,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';

@Entity()
@Unique(['user', 'targetUser'])
export class Block {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User; // کسی که بلاک کرده

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  targetUser: User; // کسی که بلاک شده

  @CreateDateColumn()
  createdAt: Date;
}
