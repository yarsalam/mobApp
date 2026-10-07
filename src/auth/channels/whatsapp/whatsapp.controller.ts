import { Body, Controller, Post, Req } from '@nestjs/common';
import { OtpService } from '../../otp/otp.service';
import { WhatsAppService } from './whatsapp.service';

@Controller('auth/register/whatsapp')
export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly otpService: OtpService,
  ) {}

  /** 1) ذخیره OTP از طرف فرانت */
  @Post('save-otp')
  async saveOtp(@Body() dto: { phone: string; otp: string }) {
    const result = await this.whatsappService.saveOtp(dto.phone, dto.otp);
    console.log('phone', result);
    return result; // ← قبلاً فقط {saved: true} برمی‌گرداند، حالا {sessionId}
  }

  /** 2) واتساپ پیام را POST می‌کند اینجا */
  @Post('webhook')
  async webhook(@Body() body: { sender: string; text: string }, @Req() req) {
    if (!body.sender || !body.text) return 'NO_DATA';

    await this.whatsappService.handleIncomingMessage(body.sender, body.text);

    return { ok: true };
  }

  /** 3) فرانت چک می‌کند که آیا پیام درست دریافت شده */
  @Post('verify')
  async verify(@Body() dto: { phone: string }) {
    const verified = await this.whatsappService.isVerified(dto.phone);
    console.log('phone', dto);
    return { verified };
  }

  @Post('fallback-verify')
  async fallbackVerify(@Body() dto: { phone: string; otp: string }) {
    const storedOtp = await this.whatsappService.getStoredOtp(dto.phone);
    if (!storedOtp || storedOtp !== dto.otp) {
      return { verified: false, reason: 'otp_mismatch' };
    }
    // OTP درسته — کاربر حتماً شماره رو داشته
    await this.whatsappService.markVerifiedByFallback(dto.phone);
    return { verified: true };
  }
}
