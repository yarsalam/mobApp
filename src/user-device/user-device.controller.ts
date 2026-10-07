import { Controller, Post, Body, Req } from '@nestjs/common';
import { UserDeviceService } from './user-device.service';
import { CreateUserDeviceDto } from './dto/create-user-device.dto';

@Controller('user-device')
export class UserDeviceController {
  constructor(private readonly userDeviceService: UserDeviceService) {}

  @Post()
  async registerDevice(@Body() dto: CreateUserDeviceDto) {
    const result = await this.userDeviceService.createOrUpdateToken(dto);
    return { message: 'اطلاعات دستگاه ثبت شد', data: result };
  }
}
