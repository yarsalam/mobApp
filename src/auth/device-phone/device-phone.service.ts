import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DevicePhone } from './entities/device-phone.entity';
import { UserDevice } from 'src/user-device/entities/user-device.entity';

@Injectable()
export class DevicePhoneService {
  constructor(
    @InjectRepository(DevicePhone)
    private readonly repo: Repository<DevicePhone>,
  ) {}

  async logEvent(dto: {
    device: UserDevice;
    phone: string;
    event: DevicePhone['event'];
    verified?: boolean;
  }) {
    /**
     * قبلاً: findOne با relations: ['device']
     * این باعث می‌شد TypeORM یک JOIN به جدول user_devices اضافه کند،
     * حتی اگر هیچ‌جا از device استفاده نمی‌کردیم.
     *
     * حالا: فقط where بدون relations — یک SELECT ساده بدون JOIN.
     * device را از dto.device داریم؛ نیازی به JOIN نیست.
     */
    let record = await this.repo.findOne({
      where: {
        device: { id: dto.device.id },
        phone: dto.phone,
      },
    });

    if (record) {
      record.event = dto.event;
      record.verified = dto.verified ?? record.verified;
      return this.repo.save(record);
    }

    record = this.repo.create({
      device: dto.device,
      phone: dto.phone,
      event: dto.event,
      verified: dto.verified ?? false,
    });

    return this.repo.save(record);
  }

  async countUniquePhones(deviceId: number) {
    return this.repo.count({
      where: { device: { id: deviceId } },
    });
  }

  async countUniqueDevices(phone: string) {
    return this.repo.count({
      where: { phone },
    });
  }
}
