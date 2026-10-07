import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UserQueryService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findById(id: number) {
    return this.userRepo.findOne({
      where: { id },
      relations: ['userImages'],
    });
  }

  async getActiveUserIds(limit = 1000) {
    const users = await this.userRepo.find({
      where: { status: 'active' },
      select: ['id'],
      take: limit,
    });

    return users.map((u) => u.id);
  }
}
