import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../users/entities/user.entity';

@Controller('admin-api/phase')
@UseGuards(AdminApiGuard)
export class AdminApiPhaseController {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  @Get('distribution')
  async distribution() {
    const result = await this.userRepository
      .createQueryBuilder('user')
      .select('user.phase', 'name')
      .addSelect('COUNT(*)', 'value')
      .groupBy('user.phase')
      .getRawMany();
    return result.map((r) => ({
      name: r.name,
      value: parseInt(r.value, 10),
    }));
  }
}
