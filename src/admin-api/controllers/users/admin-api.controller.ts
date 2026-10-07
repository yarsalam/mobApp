import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AdminApiGuard } from 'src/admin-api/guards/api-key.guard';
import { User } from 'src/users/entities/user.entity';
import { UsersService } from 'src/users/users.service';
import { MoreThan, Repository } from 'typeorm';

@Controller('admin-api')
@UseGuards(AdminApiGuard)
export class AdminApiController {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,

    private readonly usersService: UsersService,
  ) {}

  @Get('users')
  async getAllUsers(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.usersService.exploreUsers(null, page - 1, limit);
  }

  @Get('users/count')
  async countUsers() {
    const total = await this.userRepository.count();
    return { total };
  }

  @Get('users/growth-rate')
  async growthRate() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [total, newUsers] = await Promise.all([
      this.userRepository.count(),
      this.userRepository.count({
        where: { createdAt: MoreThan(thirtyDaysAgo) },
      }),
    ]);
    const rate = total > 0 ? (newUsers / total) * 100 : 0;
    return { rate: Math.round(rate * 10) / 10 };
  }
}
