import {
  Body,
  Controller,
  Post,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserDeviceService } from './user-device.service';
import { CreateUserDeviceDto } from './dto/create-user-device.dto';

type AuthenticatedRequest = {
  user: {
    id?: number | string;
    sub?: number | string;
  };
};

@Controller('user-device')
@UseGuards(JwtAuthGuard)
export class UserDeviceController {
  constructor(private readonly userDeviceService: UserDeviceService) {}

  @Post()
  async registerDevice(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateUserDeviceDto,
  ) {
    const userId = Number(req.user?.id ?? req.user?.sub);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new ForbiddenException('Invalid authenticated user');
    }

    // userId کلاینت را نادیده می‌گیریم.
    const result = await this.userDeviceService.createOrUpdateToken({
      ...dto,
      userId,
    });

    return {
      message: 'اطلاعات دستگاه ثبت شد',
      data: result,
    };
  }
}
