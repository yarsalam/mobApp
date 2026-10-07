import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class WhatsAppService {
  constructor(private readonly redis: RedisService) {}

  async saveOtp(phone: string, otp: string) {
    await this.redis.set(`wa:otp:${phone}`, otp, 300);
    await this.redis.del(`wa:verified:${phone}`);

    // نگاشت phone -> wa sender
    await this.redis.set(`wa:map:${phone}`, 'pending', 300);
    const testOtp = await this.redis.get(`wa:otp:${phone}`);
    return { ok: true };
  }

  async handleIncomingMessage(sender: string, text: string) {
    // قبلاً فقط \b\d{6}\b — حالا هر ۶ رقم حتی با فاصله یا dash
    const cleaned = text.replace(/[\s\-_.]/g, '');
    const otpMatch = cleaned.match(/\d{6}/);
    if (!otpMatch) return;

    const otp = otpMatch[0];
    const keys = await this.redis.scanKeys('wa:otp:*');

    for (const key of keys) {
      const phone = key.replace('wa:otp:', '');
      const expectedOtp = await this.redis.get(key);
      const map = await this.redis.get(`wa:map:${phone}`);

      if (map !== 'pending') continue;
      if (expectedOtp !== otp) continue;

      await Promise.all([
        this.redis.set(`wa:map:${phone}`, sender, 300),
        this.redis.set(`wa:verified:${phone}`, '1', 300),
        // ذخیره sender برای fallback بعدی
        this.redis.set(`wa:sender:${phone}`, sender, 300),
        this.redis.del(key),
      ]);
      return;
    }
  }

  async isVerified(phone: string) {
    const result = !!(await this.redis.get(`wa:verified:${phone}`));
    return !!result;
  }

  async getStoredOtp(phone: string): Promise<string | null> {
    return this.redis.get(`wa:otp:${phone}`);
  }

  async markVerifiedByFallback(phone: string) {
    await Promise.all([
      this.redis.set(`wa:verified:${phone}`, '1', 300),
      this.redis.set(`wa:map:${phone}`, 'fallback', 300),
      this.redis.del(`wa:otp:${phone}`),
    ]);
  }
}
