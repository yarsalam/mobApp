import { Controller, Post, Body, UseGuards, Req, Get } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserPhonesService } from './user-phones.service';
import { CreateUserPhoneDto } from './dto/create-user-phone.dto';
import { VerifyUserPhoneDto } from './dto/verify-user-phone.dto';

@Controller('user-phones')
@UseGuards(JwtAuthGuard)
export class UserPhonesController {
  constructor(private readonly userPhonesService: UserPhonesService) {}

  @Post('change')
  async changePhone(@Req() req, @Body() dto: CreateUserPhoneDto) {
    return this.userPhonesService.addNewPhone(req.user.sub, dto, req);
  }

  @Post('verify')
  async verify(@Req() req, @Body() dto: VerifyUserPhoneDto) {
    return this.userPhonesService.verifyCode(req.user.sub, dto);
  }

  @Get('list')
  async getPhones(@Req() req) {
    return this.userPhonesService.getAllPhones(req.user.sub);
  }
}
