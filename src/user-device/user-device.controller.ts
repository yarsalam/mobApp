import {
  Body,
  Controller,
  Delete,
  Post,
  UseGuards,
  Req,
  ForbiddenException,
  IsString,
  MaxLength,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserDeviceService } from './user-device.service';
import { CreateUserDeviceDto } from './dto/create-user-device.dto';
import { IsNotEmpty } from 'class-validator';

class DisablePushDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  deviceId: string;
}

type AuthenticatedRequest = {
  user: { id?: number | string; sub?: number | string };
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

    const result = await this.userDeviceService.createOrUpdateToken({
      ...dto,
      userId,
    });

    // Never return FCM registration tokens from the device-registration API.
    const { pushToken: _pushToken, ...safeDevice } = result;
    return { message: 'اطلاعات دستگاه ثبت شد', data: safeDevice };
  }

  @Delete('push')
  async disablePush(
    @Req() req: AuthenticatedRequest,
    @Body() dto: DisablePushDto,
  ) {
    const userId = Number(req.user?.id ?? req.user?.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new ForbiddenException('Invalid authenticated user');
    }
    await this.userDeviceService.disablePush(userId, dto.deviceId);
    return { success: true };
  }
}
