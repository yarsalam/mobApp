import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RecaptchaService {
  private readonly recaptchaSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY ?? '';

    if (!this.recaptchaSecret) {
      throw new Error('❌ مقدار RECAPTCHA_SECRET_KEY در .env تنظیم نشده است!');
    }
  }

  async validateRecaptcha(token: string): Promise<boolean> {
    const url = `https://www.google.com/recaptcha/api/siteverify`;
    const params = new URLSearchParams();
    params.append('secret', this.recaptchaSecret);
    params.append('response', token);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!data.success) {
      throw new BadRequestException('⚠️ اعتبارسنجی reCAPTCHA ناموفق بود!');
    }

    return true;
  }
}
