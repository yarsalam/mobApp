import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { GetUser } from 'src/auth/decorator/get-user/get-user.decorator';
import { BadgeService } from './badge.service';

@Controller('badges')
@UseGuards(JwtAuthGuard)
export class BadgeController {
  constructor(private readonly badgeService: BadgeService) {}

  @Get()
  getBadges(@GetUser('id') userId: number) {
    return this.badgeService.getBadges(userId);
  }
}
