import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RecaptchaService {
  constructor(private readonly configService: ConfigService) {}

  async validateRecaptcha(token: string): Promise<boolean> {
    const secret =
      this.configService.get<string>('RECAPTCHA_SECRET_KEY') ??
      process.env.RECAPTCHA_SECRET_KEY;

    // Do not prevent the entire API from starting when reCAPTCHA is not
    // configured. Validation remains fail-closed whenever this method is used.
    if (!secret) {
      throw new Error('RECAPTCHA_SECRET_KEY is not configured.');
    }

    const url = 'https://www.google.com/recaptcha/api/siteverify';
    const params = new URLSearchParams();
    params.append('secret', secret);
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
