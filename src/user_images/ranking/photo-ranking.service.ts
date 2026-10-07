import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserImage } from '../entities/user_image.entity';
import { UserEventService } from '../../user-event/user-event.service';

@Injectable()
export class PhotoRankingService {
  private readonly logger = new Logger(PhotoRankingService.name);

  constructor(
    @InjectRepository(UserImage)
    private readonly imageRepo: Repository<UserImage>,
    private readonly userEventService: UserEventService,
  ) {}

  /**
   * به‌روزرسانی امتیاز عکس بر اساس تعاملات واقعی
   */
  async updatePhotoScore(photoId: number, eventType: string): Promise<void> {
    const photo = await this.imageRepo.findOne({
      where: { id: photoId },
      relations: ['user'],
    });
    if (!photo) return;

    // افزایش بازدید
    photo.views = (photo.views || 0) + 1;

    // اگه لایک شد
    if (eventType === 'LIKE') {
      photo.likes = (photo.likes || 0) + 1;
    }

    // محاسبه امتیاز تعامل
    if (photo.views > 0) {
      photo.engagementScore = (photo.likes || 0) / photo.views;
    }

    await this.imageRepo.save(photo);

    // اگه امتیاز این عکس از عکس اصلی بیشتر شد
    await this.checkMainPhoto(photo.user?.id);
  }

  /**
   * بررسی آیا عکس بهتری برای main وجود داره
   */
  private async checkMainPhoto(userId: number): Promise<void> {
    const photos = await this.imageRepo.find({
      where: { user: { id: userId } },
      order: { engagementScore: 'DESC' },
    });

    if (photos.length === 0) return;

    const bestPhoto = photos[0];
    const currentMain = photos.find((p) => p.isMain);

    // اگه عکس بهتری وجود داره و امتیازش حداقل ۲۰٪ بیشتره
    if (!currentMain) {
      bestPhoto.isMain = true;
      await this.imageRepo.save(bestPhoto);
    } else if (
      currentMain.id !== bestPhoto.id &&
      (bestPhoto.engagementScore || 0) >
        (currentMain.engagementScore || 0) * 1.2
    ) {
      currentMain.isMain = false;
      bestPhoto.isMain = true;

      await this.imageRepo.save([currentMain, bestPhoto]);

      this.logger.log(`Auto-switched main photo for user ${userId}`);
    }
  }

  /**
   * پیشنهاد بهترین عکس به Assistant
   */
  async getPhotoAdvice(userId: number): Promise<string> {
    const photos = await this.imageRepo.find({
      where: { user: { id: userId } },
    });

    if (photos.length === 0) {
      return '📸 عکس پروفایل ندارید! کاربران با عکس ۱۰ برابر بیشتر دیده می‌شن.';
    }

    const best = photos.sort(
      (a, b) => (b.engagementScore || 0) - (a.engagementScore || 0),
    )[0];

    if (!best.engagementScore || best.engagementScore < 0.05) {
      return '📊 عکس‌هات تعامل کمی دارن. یه عکس با لبخند و نور خوب امتحان کن.';
    }

    if (best.faceCount === 0) {
      return '👤 عکس‌هات چهره ندارن! کاربرا دوست دارن ببینن چه شکلی هستی.';
    }

    if (best.smileScore && best.smileScore < 0.5) {
      return '😊 با لبخند عکس بگیر، ۴۰٪ بیشتر لایک می‌گیری!';
    }

    if (best.faceCount && best.faceCount > 1) {
      return '👥 عکس‌های تکی بهتر جواب میدن. بقیه حواسشون پرت میشه!';
    }

    return '✨ عکس‌هات خوبن! می‌تونی با Photo Boost بیشتر دیده بشی.';
  }
}
