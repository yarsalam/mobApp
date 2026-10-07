import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { CreateAuthDto } from './dto/create-auth.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { AuthRegistrationService } from './services/auth-registration.service';
import { AuthLoginService } from './services/auth-login.service';
import { AuthProfileService } from './services/auth-profile.service';
import { UsersService } from 'src/users/users.service';
import { UserPhonesService } from 'src/user-phones/user-phones.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly registration: AuthRegistrationService,
    private readonly loginService: AuthLoginService,
    private readonly profileService: AuthProfileService,
    private readonly usersService: UsersService,
    private readonly userPhonesService: UserPhonesService,
  ) {}

  async step1(createAuthDto: CreateAuthDto, req: Request) {
    return this.registration.step1(createAuthDto, req);
  }

  async completeVerification(phone: string, clientDeviceId: string) {
    return this.registration.completeVerification(phone, clientDeviceId);
  }

  async completeProfile(dto: CompleteProfileDto, userFromReq: any) {
    return this.registration.completeProfile(dto, userFromReq);
  }

  async login(phone: string, password: string) {
    return this.loginService.login(phone, password);
  }

  async getProfile(payload: any) {
    return this.profileService.getProfile(payload);
  }

  async changePassword(userId: number, newPassword: string) {
    return this.profileService.changePassword(userId, newPassword);
  }

  async getRegisterStatus(phone: string) {
    return this.profileService.getRegisterStatus(phone);
  }

  async simLogin(phone: string, gender: string) {
    let user = await this.usersService.findByPhone(phone);
    if (user) return user;

    // مرحله ۱: ساخت کاربر با حداقل داده (فقط phone, gender)
    user = await this.usersService.create({
      phone,
      gender,
      isCompleted: false,
    });

    // مرحله ۲: تکمیل پروفایل با آپدیت
    await this.usersService.update(user.id, {
      nickname: `user_${phone.slice(-4)}`,
      city: 'تهران',
      province: 'تهران',
      birth_year: '1375',
      birth_month: '06',
      birth_day: '15',
      marital: 'single',
      education: 'bachelor',
      employment: 'employee',
      height: '175',
      weight: '70',
      health: 'سالم',
      nationality: 'ایرانی',
      religion: 'اسلام',
      aboutme: 'سلام، من یک کاربر تست هستم!',
      partner_about: 'به دنبال یک همراه خوب می‌گردم.',
      hobbies_self: ['کتاب‌خوانی', 'ورزش', 'سفر'],
      values_self: ['صداقت', 'مهربانی'],
      hobbies_partner: ['موسیقی', 'فیلم', 'طبیعت‌گردی'],
      values_partner: ['وفاداری', 'احترام'],
      isCompleted: true,
    });

    // اضافه کردن شماره به لیست تلفن‌های کاربر
    if (this.userPhonesService) {
      try {
        await this.userPhonesService.addFirstPhone(user.id, phone);
        await this.userPhonesService.markAsVerified(user.id, phone);
      } catch (e) {
        // نادیده گرفتن خطا
      }
    }

    return user;
  }
}
