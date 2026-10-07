import { Injectable } from '@nestjs/common';
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

  async createOrUpdateToken(dto: CreateUserDeviceDto): Promise<UserDevice> {
    /**
     * قبلاً: await this.userRepo.findOne({ where: { id: dto.userId } })
     * این یک کوئری اضافه بود — user را از جایی که صداش زدیم می‌دانستیم.
     * TypeORM برای ManyToOne یک entity reference ساده هم کافی است:
     * { id: userId } as User  — بدون هیچ SELECT.
     */
    const userRef = { id: dto.userId } as User;

    const deviceData = {
      user: userRef,
      ipAddress: dto.ipAddress,
      platform: dto.platform,
      model: dto.model ?? 'unknown',
      brand: dto.brand ?? 'unknown',
      deviceId: dto.deviceId,
      osVersion: dto.osVersion,
      appVersion: dto.appVersion,
      country: dto.country,
      city: dto.city,
      isVPN: dto.isVpn,
      isOnline: true,
    };

    const existing = await this.userDeviceRepo.findOne({
      where: { user: { id: dto.userId }, deviceId: dto.deviceId },
    });

    if (existing) {
      Object.assign(existing, deviceData);
      return this.userDeviceRepo.save(existing);
    }

    const newDevice = this.userDeviceRepo.create(deviceData);
    return this.userDeviceRepo.save(newDevice);
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

  async findByClientDeviceId(deviceId: string): Promise<UserDevice | null> {
    return this.userDeviceRepo.findOne({
      where: { deviceId },
    });
  }
}
