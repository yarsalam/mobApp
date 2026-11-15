import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { CreateUserDeviceDto } from './dto/create-user-device.dto';
import { UserDevice } from './entities/user-device.entity';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class UserDeviceService {
  constructor(
    @InjectRepository(UserDevice)
    private readonly userDeviceRepo: Repository<UserDevice>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async createOrUpdateDevice(dto: CreateUserDeviceDto): Promise<UserDevice> {
    if (!Number.isSafeInteger(dto.userId) || dto.userId <= 0) {
      throw new BadRequestException('شناسه کاربر معتبر نیست');
    }
    if (
      typeof dto.deviceId !== 'string' ||
      dto.deviceId.trim().length < 8 ||
      dto.deviceId.length > 200
    ) {
      throw new BadRequestException('شناسه دستگاه معتبر نیست');
    }

    const userExists = await this.userRepo.exist({ where: { id: dto.userId } });
    if (!userExists) throw new NotFoundException('کاربر یافت نشد');

    const existing = await this.userDeviceRepo.findOne({
      where: { user: { id: dto.userId }, deviceId: dto.deviceId },
    });

    const deviceData = {
      user: { id: dto.userId } as User,
      ipAddress: dto.ipAddress ?? existing?.ipAddress,
      platform: dto.platform ?? existing?.platform,
      model: dto.model ?? existing?.model ?? 'unknown',
      brand: dto.brand ?? existing?.brand ?? 'unknown',
      deviceId: dto.deviceId,
      osVersion: dto.osVersion ?? existing?.osVersion,
      appVersion: dto.appVersion ?? existing?.appVersion,
      country: dto.country ?? existing?.country,
      city: dto.city ?? existing?.city,
      timezone: dto.timezone ?? existing?.timezone,
      isVPN: dto.isVpn ?? existing?.isVPN ?? false,
      isOnline: true,
    };

    if (existing) {
      Object.assign(existing, deviceData);
      return this.userDeviceRepo.save(existing);
    }
    return this.userDeviceRepo.save(this.userDeviceRepo.create(deviceData));
  }

  async countRequestsByIp(ip: string, sinceMinutes = 30): Promise<number> {
    const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
    return this.userDeviceRepo.count({
      where: { ipAddress: ip, createdAt: MoreThan(since) },
    });
  }

  async setOnlineStatus(userId: number, isOnline: boolean) {
    await this.userDeviceRepo
      .createQueryBuilder()
      .update(UserDevice)
      .set({ isOnline })
      .where('userId = :userId', { userId })
      .execute();
  }

  async findByClientDeviceId(
    userId: number,
    deviceId: string,
  ): Promise<UserDevice | null> {
    return this.userDeviceRepo.findOne({
      where: { user: { id: userId }, deviceId },
    });
  }
}
