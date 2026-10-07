import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { TelegramService } from '../channels/telegram/telegram.service';
import { WhatsAppService } from '../channels/whatsapp/whatsapp.service';
import { UserEventService } from '../../user-event/user-event.service';
import * as bcrypt from 'bcrypt';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class AuthProfileService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly telegramService: TelegramService,
    private readonly whatsappService: WhatsAppService,
    private readonly userEventService: UserEventService,
  ) {}

  async getProfile(payload: any) {
    const userId = Number(payload?.sub);
    if (!userId) throw new UnauthorizedException('کاربر یافت نشد');
    return this.usersService.findById(userId);
  }

  async changePassword(userId: number, newPassword: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    const hashed = await bcrypt.hash(newPassword, 10);
    await this.usersService.update(userId, { password: hashed });
    await this.userEventService.log({
      userId,
      type: EventType.PASSWORD_CHANGE,
      metadata: { via: 'settings' },
    });
    return { message: 'رمز عبور با موفقیت تغییر یافت' };
  }

  async getRegisterStatus(phone: string) {
    const user = await this.usersService.findByPhone(phone);
    if (!user) {
      return {
        exists: false,
        step: 'START',
        message: 'کاربر وجود ندارد، مرحله ۱ شروع شود',
      };
    }

    const userPhone = user.phones?.find((p) => p.phone === phone);
    if (!userPhone) {
      throw new BadRequestException('شماره برای این یوزر ثبت نشده است');
    }

    if (userPhone.isVerified) {
      return {
        exists: true,
        phone,
        isVerified: true,
        isCompleted: user.isCompleted,
        step: user.isCompleted ? 'DONE' : 'PROFILE',
      };
    }

    const waVerified = await this.whatsappService.isVerified(phone);
    const tgVerified =
      (await this.telegramService.isVerified?.(phone)) ?? false;

    if (waVerified || tgVerified) {
      return {
        exists: true,
        phone,
        isVerified: true,
        via: waVerified ? 'whatsapp' : 'telegram',
        step: 'VERIFIED_NEEDS_TEMP_TOKEN',
      };
    }

    return {
      exists: true,
      phone,
      isVerified: false,
      step: 'WAIT_FOR_OTP',
    };
  }
}
