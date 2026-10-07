import {
  Injectable,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { performance } from 'perf_hooks';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { UserPhonesService } from '../../user-phones/user-phones.service';
import { UserDeviceService } from '../../user-device/user-device.service';
import { TelegramService } from '../channels/telegram/telegram.service';
import { WhatsAppService } from '../channels/whatsapp/whatsapp.service';
import { RedisService } from '../../redis/redis.service';
import { DevicePhoneService } from '../device-phone/device-phone.service';
import { DevicePhoneEvent } from '../device-phone/entities/device-phone.entity';
import { UserEventService } from '../../user-event/user-event.service';
import { PhaseService } from '../../phase/phase.service';
import { CreateAuthDto } from '../dto/create-auth.dto';
import { CompleteProfileDto } from '../dto/complete-profile.dto';
import { UpdateUserDto } from '../../users/dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { RequestHelper } from 'src/helpers/RequestHelper';
import { EventType } from 'src/user-event/type/event-type.enum';

type InternalUpdateData = Partial<UpdateUserDto> & {
  password?: string;
  isCompleted?: boolean;
};
@Injectable()
export class AuthRegistrationService {
  private readonly logger = new Logger(AuthRegistrationService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly userPhonesService: UserPhonesService,
    private readonly userDeviceService: UserDeviceService,
    private readonly telegramService: TelegramService,
    private readonly whatsappService: WhatsAppService,
    private readonly redis: RedisService,
    private readonly devicePhoneService: DevicePhoneService,
    private readonly userEventService: UserEventService,
    private readonly phaseService: PhaseService,
  ) {}

  async step1(createAuthDto: CreateAuthDto, req: Request) {
    console.log('STEP1 PHONE=', createAuthDto.phone);
    const t0 = performance.now();
    const mark = (label: string, from: number): number => {
      this.logger.debug(
        `[step1] ${label}: ${Math.round(performance.now() - from)}ms`,
      );
      return performance.now();
    };

    try {
      // ── ۱) findByPhone: یک کوئری OR به‌جای دو کوئری ──────────────────
      let t = t0;
      const existingUser = await this.usersService.findByPhone(
        createAuthDto.phone,
      );
      t = mark('findByPhone', t);

      if (existingUser?.status === 'admin_blocked') {
        throw new ForbiddenException('حساب شما مسدود شده است');
      }

      if (existingUser?.isCompleted) {
        throw new HttpException(
          { message: 'این شماره قبلاً ثبت‌نام کرده.', code: 'EXISTING_USER' },
          HttpStatus.CONFLICT,
        );
      }

      // ── ۲) create یا update user ─────────────────────────────────────
      const { recaptchaToken, platform, ...userData } = createAuthDto;

      const referer = req.headers['referer'] || req.headers['referrer'] || '';
      const ua = (req.headers['user-agent'] as string) || '';

      // تشخیص خودکار source اگه فرانت نفرستاده باشه
      let autoSource = 'direct';
      if (referer.includes('instagram.com')) autoSource = 'instagram';
      else if (referer.includes('t.me') || referer.includes('telegram'))
        autoSource = 'telegram';
      else if (referer.includes('web.whatsapp.com')) autoSource = 'whatsapp';
      else if (referer.includes('google.com')) autoSource = 'google';
      else if (referer.includes('bale.ai')) autoSource = 'bale';
      else if (referer.includes('myket.ir')) autoSource = 'myket';
      else if (referer.includes('cafebazaar.ir')) autoSource = 'bazaar';

      let user;
      if (existingUser) {
        const updateData: any = { ...userData };
        if (
          !existingUser.acquisitionSource &&
          (userData.acquisitionSource || autoSource)
        ) {
          updateData.acquisitionSource =
            userData.acquisitionSource || autoSource;
        }

        user = await this.usersService.update(existingUser.id, updateData);
      } else {
        user = await this.usersService.create({
          ...userData,
          acquisitionSource: userData.acquisitionSource || autoSource,
          acquisitionKeyword: userData.acquisitionKeyword || undefined,
          metadata: {
            ...userData,
            acquisitionMeta: {
              userAgent: ua.substring(0, 200),
            },
          },
        });
      }
      t = mark(existingUser ? 'updateUser' : 'createUser', t);
      console.log('CREATED USER=', user);
      const ci = (req as any).clientInfo || {};
      // deviceId از middleware یا مستقیم از header — RequestHelper تضمین می‌کند
      const deviceId =
        RequestHelper.getDeviceId(req) ||
        `srv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // ── ۳) Promise.all: device + phone + event به‌صورت موازی ─────────
      // این سه عملیات مستقل هستند و می‌توانند همزمان اجرا شوند.
      // با pool_size=10 و 50 کاربر همزمان، این موازی‌سازی بیشترین
      // اثر را در کاهش latency دارد.
      const [device] = await Promise.all([
        this.userDeviceService.createOrUpdateToken({
          userId: user.id,
          userAgent: (req.headers['user-agent'] as string) || 'unknown',
          ipAddress: ci.ip || '0.0.0.0',
          deviceId,
          platform: ['web', 'mobile'].includes(ci.platform ?? '')
            ? (ci.platform as 'web' | 'mobile')
            : platform === 'mobile'
              ? 'mobile'
              : 'web',
          brand: ci.brand,
          model: ci.model,
          osVersion: ci.osVersion,
          appVersion: ci.appVersion,
          country: ci.country,
          city: ci.city,
          isVpn: ci.isVpn ?? false,
        }),
        existingUser
          ? Promise.resolve()
          : this.userPhonesService.addFirstPhone(user.id, createAuthDto.phone),
        this.userEventService.log({
          userId: user.id,
          type: EventType.LOGIN,
          metadata: { via: 'signup', platform: createAuthDto.platform },
        }),
      ]);
      t = mark('Promise.all (device, phone, event)', t);

      // ── ۴) logEvent روی device (بعد از ایجاد device) ─────────────────
      await this.devicePhoneService.logEvent({
        device,
        phone: createAuthDto.phone,
        event: DevicePhoneEvent.SEEN,
      });
      mark('devicePhone.logEvent', t);

      this.logger.debug(
        `[step1] TOTAL: ${Math.round(performance.now() - t0)}ms`,
      );

      return { success: true };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`step1 failed for ${createAuthDto.phone}: ${msg}`);
      throw new InternalServerErrorException('خطا در پردازش درخواست');
    }
  }

  async completeVerification(phone: string, clientDeviceId: string) {
    const verified =
      (await this.whatsappService.isVerified(phone)) ||
      (await this.telegramService.isVerified(phone));
    console.log('PHONE=', phone);
    console.log('verified=', verified);
    if (!verified) {
      throw new UnauthorizedException('تأیید هنوز انجام نشده است');
    }

    const user = await this.usersService.findByPhone(phone);
    console.log('USER=', user);
    if (!user) {
      throw new UnauthorizedException('کاربر در مرحله ۱ ثبت نشده است');
    }

    await this.userPhonesService.markAsVerified(user.id, phone);

    const device =
      await this.userDeviceService.findByClientDeviceId(clientDeviceId);
    if (!device) {
      throw new BadRequestException(
        `دستگاه با شناسه ${clientDeviceId} یافت نشد. آیا step1 با همین X-Device-Id انجام شد؟`,
      );
    }

    await Promise.all([
      this.devicePhoneService.logEvent({
        device,
        phone,
        event: DevicePhoneEvent.VERIFIED,
        verified: true,
      }),
      this.userEventService.log({
        userId: user.id,
        type: EventType.APP_OPEN,
        metadata: { via: 'verification' },
      }),
      this.redis.del(`tg:verified:${phone}`),
    ]);

    const payload = { sub: user.id, phone, temporary: true };
    const token = this.jwtService.sign(payload, { expiresIn: '30m' });

    return { message: 'تأیید با موفقیت انجام شد', token };
  }

  async completeProfile(dto: CompleteProfileDto, userFromReq: any) {
    try {
      const userId = Number(userFromReq?.sub);
      const isTemporary = userFromReq?.temporary === true;
      if (!userId) throw new UnauthorizedException('کاربر معتبر نیست');
      if (!isTemporary)
        throw new UnauthorizedException(
          'توکن معتبر نیست یا مرحله قبلی انجام نشده است',
        );

      const user = await this.usersService.findById(userId);
      if (!user) throw new UnauthorizedException('کاربر یافت نشد');
      if (user?.status === 'admin_blocked') {
        throw new ForbiddenException('حساب شما مسدود شده است');
      }
      const changedFields: string[] = [];
      if (dto.nickname !== undefined) changedFields.push('nickname');
      if (dto.birthDate)
        changedFields.push('birth_year', 'birth_month', 'birth_day');
      if (dto.marital !== undefined) changedFields.push('marital');
      if (dto.province !== undefined) changedFields.push('province');
      if (dto.city !== undefined) changedFields.push('city');
      if (dto.nationality !== undefined) changedFields.push('nationality');
      if (dto.education !== undefined) changedFields.push('education');
      if (dto.employment !== undefined) changedFields.push('employment');
      if (dto.height !== undefined) changedFields.push('height');
      if (dto.weight !== undefined) changedFields.push('weight');
      if (dto.health !== undefined) changedFields.push('health');
      if (dto.religion !== undefined) changedFields.push('religion');
      if (dto.aboutme !== undefined) changedFields.push('aboutme');
      if (dto.values_self !== undefined) changedFields.push('values_self');
      if (dto.hobbies_self !== undefined) changedFields.push('hobbies_self');
      if (dto.partner_about !== undefined) changedFields.push('partner_about');
      if (dto.values_partner !== undefined)
        changedFields.push('values_partner');
      if (dto.hobbies_partner !== undefined)
        changedFields.push('hobbies_partner');

      const updateData: InternalUpdateData = {
        nickname: dto.nickname,
        birth_day: dto.birthDate.day,
        birth_month: dto.birthDate.month,
        birth_year: dto.birthDate.year,
        marital: dto.marital,
        province: dto.province,
        city: dto.city,
        nationality: dto.nationality,
        education: dto.education,
        employment: dto.employment,
        height: dto.height,
        weight: dto.weight,
        health: dto.health,
        religion: dto.religion,
        aboutme: dto.aboutme,
        values_self: dto.values_self,
        hobbies_self: dto.hobbies_self,
        partner_about: dto.partner_about,
        values_partner: dto.values_partner,
        hobbies_partner: dto.hobbies_partner,
        isCompleted: true,
      };

      if (dto.password?.trim()) {
        updateData.password = await bcrypt.hash(dto.password, 10); // ✅ دیگر error نمی‌دهد
        changedFields.push('password');
      }

      if (dto.acquisitionSource && !user.acquisitionSource) {
        updateData.acquisitionSource = dto.acquisitionSource;
        changedFields.push('acquisitionSource');
      }

      const updatedUser = await this.usersService.update(userId, updateData);
      if (!updatedUser)
        throw new InternalServerErrorException('به‌روزرسانی ناموفق');

      const events: Promise<any>[] = [
        this.phaseService.learnFromFeedback(userId, 'profile_completed'),
        this.userPhonesService.markAsActived(userId, updatedUser.phone),
      ];
      if (changedFields.length > 0) {
        events.push(
          this.userEventService.log({
            userId,
            type: EventType.PROFILE_UPDATE,
            metadata: { fields: changedFields, source: 'complete_profile' },
          }),
        );
      }
      if (dto.password?.trim()) {
        events.push(
          this.userEventService.log({
            userId,
            type: EventType.PASSWORD_CHANGE,
            metadata: { via: 'complete_profile' },
          }),
        );
      }
      await Promise.all(events);

      const finalToken = this.jwtService.sign(
        { sub: updatedUser.id, phone: updatedUser.phone },
        { expiresIn: '30d' },
      );

      return { user: updatedUser, token: finalToken };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException('خطا در تکمیل پروفایل');
    }
  }
}
