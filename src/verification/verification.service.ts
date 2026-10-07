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
  ): Promise<any> {
    try {
      const user = await this.userRepo.findOne({
        where: { id: userId },
        relations: ['userImages'],
      });

      if (!user) {
        return { success: false, message: 'کاربر یافت نشد' };
      }

      const mainPhoto = user.userImages?.find((img) => img.isMain);
      if (!mainPhoto) {
        return { success: false, message: 'عکس اصلی پروفایل یافت نشد' };
      }

      const selfiePath = `/tmp/selfie_${uuidv4()}.jpg`;
      fs.writeFileSync(selfiePath, selfieFile.buffer);

      // استفاده از form-data به جای FormData native
      const form = new FormData();

      form.append('selfie', fs.createReadStream(selfiePath), {
        filename: 'selfie.jpg', // ← مهم: اسم فایل را بده
        contentType: 'image/jpeg',
      });

      form.append('profile_photo', fs.createReadStream(mainPhoto.path), {
        filename: path.basename(mainPhoto.path),
        contentType: 'image/jpeg',
      });

      const response = await firstValueFrom(
        this.httpService.post(
          `${process.env.FACE_VERIFICATION_URL}/verify`,
          form, // مستقیم form را بده
          {
            headers: {
              ...form.getHeaders(), // ← getHeaders() اینجا کار می‌کند
            },
          },
        ),
      );

      const result = response.data;

      fs.unlinkSync(selfiePath);

      if (result.verified) {
        await this.userRepo.update(userId, {
          isFaceVerified: true,
          faceVerifiedAt: new Date(),
          trustScore: () => 'trustScore + 15',
        });

        await this.queueUpdate(userId);
      }

      return {
        success: true,
        verified: result.verified,
        confidence: result.confidence,
        message: result.message,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Verification failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        success: false,
        message: 'خطا در انجام تأیید',
      };
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
