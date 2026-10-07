import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  Get,
  UseGuards,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateAuthDto } from './dto/create-auth.dto';
import { Response, Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RecaptchaService } from 'src/recaptcha/recaptcha.service';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { authCookieOptions } from 'src/helpers/cookieOptions';
import { ChangePasswordDto } from './dto/change-password.dto';
import { TemporaryOnlyGuard } from './temporary-only-guard.guard';
import { CurrentUser } from 'src/current-user/current-user.decorator';
import { RequestHelper } from 'src/helpers/RequestHelper';
import { UserEventService } from 'src/user-event/user-event.service';
import { GetUser } from './decorator/get-user/get-user.decorator';
import { JwtService } from '@nestjs/jwt';
import { EventType } from 'src/user-event/type/event-type.enum';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly recaptchaService: RecaptchaService,
    private readonly userEventService: UserEventService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * مرحله ۱ ثبت‌نام: ارسال OTP
   * reCAPTCHA در DTO فعلاً optional است (برای تست)؛
   * برای production روی ValidateIf برمی‌گردانیم.
   */
  @Post('register/step1')
  async step1(@Body() registerDto: CreateAuthDto, @Req() req: Request) {
    return this.authService.step1(registerDto, req);
  }

  /**
   * تکمیل پروفایل — TemporaryOnlyGuard اجرا می‌شود:
   * فقط توکن‌های موقت (temporary: true) مجاز هستند.
   */
  @UseGuards(TemporaryOnlyGuard)
  @Post('register/completeProfile')
  async completeProfile(
    @Body() completeProfileDto: CompleteProfileDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    console.log('body', Body);
    const { user, token } = await this.authService.completeProfile(
      completeProfileDto,
      req.user,
    );
    res.cookie('auth_token', token, authCookieOptions);
    return res.send({ message: 'پروفایل با موفقیت کامل شد', token });
  }

  @Post('login')
  async login(
    @Body()
    body: { phone: string; password: string; platform: 'web' | 'mobile' },
    @Res() res: Response,
  ) {
    const { token } = await this.authService.login(body.phone, body.password);
    if (body.platform === 'web') {
      res.cookie('auth_token', token, authCookieOptions);
    }
    return res.send({ message: 'ورود موفق', token });
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Body() body: { platform: 'web' | 'mobile' },
    @GetUser('id') userId: number,
    @Res() res: Response,
  ) {
    if (body.platform === 'web') {
      res.clearCookie('auth_token', authCookieOptions);
    }
    await this.userEventService.log({
      userId,
      type: EventType.LOGOUT,
      metadata: { platform: body.platform },
    });
    return res.json({ message: 'با موفقیت خارج شدید' });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@CurrentUser() user) {
    return this.authService.getProfile(user);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@CurrentUser() user, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.sub, dto.password);
  }

  @Get('mobile/register-status')
  async getMobileRegisterStatus(
    @Query('phone') phone: string,
    @Req() req: Request,
  ) {
    if (!phone) throw new BadRequestException('Phone is required');
    return this.authService.getRegisterStatus(phone);
  }

  @Post('register/complete-verification')
  async completeVerification(
    @Body('phone') phone: string,
    @Req() req: Request,
  ) {
    const deviceId = RequestHelper.requireDeviceId(req);
    return this.authService.completeVerification(phone, deviceId);
  }

  /**
   * ابزار توسعه/بنچ‌مارک: مستقیماً یک کاربر کامل می‌سازد و JWT برمی‌گرداند.
   * در production وجود ندارد — با 404 پاسخ می‌دهد.
   */

  @Post('sim-login')
  async simLogin(@Body() body: { phone: string; gender?: string }) {
    const user = await this.authService.simLogin(
      body.phone,
      body.gender || 'male',
    );
    const token = this.jwtService.sign(
      { sub: user.id, phone: user.phone },
      { expiresIn: '30d' },
    );
    return { token };
  }
}
