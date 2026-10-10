import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly httpService: HttpService,
  ) {}

  /**
   * درخواست تأیید چهره
   */

  async requestVerification(
    userId: number,
    selfieFile: Express.Multer.File,
  ): Promise<{
    success: boolean;
    verified?: boolean;
    confidence?: number;
    message: string;
  }> {
    let selfiePath: string | undefined;

    try {
      if (
        !Number.isSafeInteger(userId) ||
        userId <= 0 ||
        !selfieFile?.buffer?.length
      ) {
        return {
          success: false,
          message: 'اطلاعات تصویر یا کاربر معتبر نیست',
        };
      }

      // محدودیت پایه؛ محدودیت اصلی باید در FileInterceptor نیز باشد.
      const maxBytes = 5 * 1024 * 1024;

      if (selfieFile.size > maxBytes) {
        return {
          success: false,
          message: 'حجم تصویر نباید بیشتر از ۵ مگابایت باشد',
        };
      }

      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(selfieFile.mimetype)
      ) {
        return {
          success: false,
          message: 'فرمت تصویر پشتیبانی نمی‌شود',
        };
      }

      const user = await this.userRepo.findOne({
        where: { id: userId },
        relations: ['userImages'],
      });

      if (!user) {
        return { success: false, message: 'کاربر یافت نشد' };
      }

      if (user.isFaceVerified) {
        return {
          success: true,
          verified: true,
          confidence: 1,
          message: 'این حساب قبلاً تأیید شده است',
        };
      }

      const mainPhoto = user.userImages?.find(
        (img) => img.isMain && img.approved,
      );

      if (!mainPhoto) {
        return {
          success: false,
          message: 'عکس اصلی تأییدشده‌ای برای پروفایل وجود ندارد',
        };
      }

      // جلوگیری از ارسال مسیر نامعتبر یا فایل مفقود به سرویس خارجی
      await fs.promises.access(mainPhoto.path, fs.constants.R_OK);

      selfiePath = path.join('/tmp', `selfie_${uuidv4()}.jpg`);

      await fs.promises.writeFile(selfiePath, selfieFile.buffer, {
        mode: 0o600,
        flag: 'wx',
      });

      const form = new FormData();

      form.append('selfie', fs.createReadStream(selfiePath), {
        filename: 'selfie.jpg',
        contentType: 'image/jpeg',
      });

      form.append('profile_photo', fs.createReadStream(mainPhoto.path), {
        filename: path.basename(mainPhoto.path),
        contentType: 'image/jpeg',
      });

      const baseUrl = process.env.FACE_VERIFICATION_URL;

      if (!baseUrl) {
        throw new Error('FACE_VERIFICATION_URL is not configured');
      }

      const response = await firstValueFrom(
        this.httpService.post(`${baseUrl}/verify`, form, {
          headers: form.getHeaders(),
          timeout: 8000,
          maxBodyLength: 10 * 1024 * 1024,
          maxContentLength: 2 * 1024 * 1024,
        }),
      );

      const result = response.data as {
        verified?: unknown;
        confidence?: unknown;
        message?: unknown;
      };

      if (typeof result?.verified !== 'boolean') {
        throw new Error('Invalid face verification response');
      }

      const confidence = Number(result.confidence);

      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new Error('Invalid face verification confidence');
      }

      if (result.verified) {
        /*
         * فقط درخواست اول که isFaceVerified=false را تغییر می‌دهد،
         * پاداش Trust می‌گیرد. درخواست‌های هم‌زمان هم پاداش تکراری
         * دریافت نمی‌کنند.
         */
        const updateResult = await this.userRepo
          .createQueryBuilder()
          .update(User)
          .set({
            isFaceVerified: true,
            faceVerifiedAt: new Date(),
            trustScore: () => 'LEAST(100, COALESCE(trustScore, 50) + 15)',
          })
          .where('id = :userId', { userId })
          .andWhere('isFaceVerified = :verified', { verified: false })
          .execute();

        if (updateResult.affected) {
          await this.queueUpdate(userId);
        }
      }

      return {
        success: true,
        verified: result.verified,
        confidence,
        message:
          typeof result.message === 'string'
            ? result.message
            : result.verified
              ? 'تأیید چهره موفق بود'
              : 'تأیید چهره انجام نشد',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Verification failed: ${message}`);

      return {
        success: false,
        message: 'خطا در انجام تأیید',
      };
    } finally {
      if (selfiePath) {
        try {
          await fs.promises.unlink(selfiePath);
        } catch (error: unknown) {
          const code =
            typeof error === 'object' && error !== null && 'code' in error
              ? String((error as { code: unknown }).code)
              : '';

          if (code !== 'ENOENT') {
            this.logger.warn('Could not remove temporary selfie file');
          }
        }
      }
    }
  }

  /**
   * دریافت وضعیت تأیید کاربر
   */
  async getVerificationStatus(userId: number): Promise<any> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['isFaceVerified', 'faceVerifiedAt', 'trustScore'],
    });

    return {
      verified: user?.isFaceVerified || false,
      verifiedAt: user?.faceVerifiedAt,
      trustScore: user?.trustScore || 50,
      badge: this.getBadge(user),
    };
  }

  private getBadge(user: any): string | null {
    if (!user?.isFaceVerified) return null;

    if (user.trustScore > 80) {
      return '⭐ کاربر ویژه تأیید شده';
    }
    return '✅ کاربر تأیید شده';
  }

  private async queueUpdate(userId: number) {
    // TODO: ارسال به صف برای به‌روزرسانی سرویس‌های دیگه
    this.logger.log(`User ${userId} verification queued for updates`);
  }
}
