import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  Patch,
} from '@nestjs/common';
import { ProfileVisitorsService } from './profile-visitors.service';
import { CreateProfileVisitorDto } from './dto/create-profile-visitor.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('profile-visitors')
export class ProfileVisitorsController {
  constructor(
    private readonly profileVisitorsService: ProfileVisitorsService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard) // ← اضافه شد
  create(@Req() req, @Body() dto: CreateProfileVisitorDto) {
    return this.profileVisitorsService.createVisitor(
      req.user.sub, // ← visitorId از JWT، نه از body
      dto.profileId,
    );
  }

  @Get() // ← مسیر تغییر کرد از ':profileId' به ''
  @UseGuards(JwtAuthGuard) // ← اضافه شد
  async getProfileVisitors(@Req() req) {
    return this.profileVisitorsService.getProfileVisitors(req.user.sub); // ← از JWT
  }

  @Patch('mark-read/:visitorId')
  @UseGuards(JwtAuthGuard)
  async markAsRead(
    @Req() req,
    @Param('visitorId', ParseIntPipe) visitorId: number,
  ) {
    return this.profileVisitorsService.markAsRead(req.user.sub, visitorId);
  }
}
