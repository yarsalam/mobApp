import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserImage } from './entities/user_image.entity';
import { User } from 'src/users/entities/user.entity';
import { CreateUserImageDto } from './dto/create-user_image.dto';
import * as fs from 'fs';
import * as path from 'path';
import { resizeAndSaveImageHelper } from 'src/helpers/resizeImage';
import { AiImageService } from 'src/ai-image/ai-image.service';
import { UserEventService } from 'src/user-event/user-event.service';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class UserImageService {
  constructor(
    @InjectRepository(UserImage)
    private userImageRepository: Repository<UserImage>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly aiImageService: AiImageService,
    private readonly userEventService: UserEventService,
  ) {}

  async findUserByPhone(phone: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { phone } });
  }

  async createUserImage(
    file: Express.Multer.File,
    userId: number,
    isMain: boolean,
  ): Promise<UserImage> {
    const dto: CreateUserImageDto = await resizeAndSaveImageHelper(
      file,
      userId,
      isMain,
    );

    const user = await this.userRepository.findOne({
      where: { id: dto.user_id },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // 👇 اگر isMain true بود، بقیه تصاویر اصلی این کاربر رو false کن
    if (isMain) {
      await this.userImageRepository.update(
        { user: { id: userId }, isMain: true },
        { isMain: false },
      );
      // await this.userRepository.save(user);
    }

    const newImage = this.userImageRepository.create({
      filename: dto.filename,
      path: dto.path,
      url: dto.url,
      approved: dto.approved,
      isMain: dto.isMain,
      user,
    });
    await this.aiImageService.upload({
      userId: user.id,
      path: dto.path,
      filename: dto.filename,
      url: dto.url,
    });
    await this.userEventService.log({
      userId,
      type: EventType.PHOTO_UPLOAD,
      metadata: {
        isMain,
        filename: dto.filename,
      },
    });
    return this.userImageRepository.save(newImage);
  }

  async countUserImages(userId: number): Promise<number> {
    return this.userImageRepository.count({ where: { user: { id: userId } } });
  }

  async getImagesByUserId(userId: number): Promise<Partial<UserImage>[]> {
    const images = await this.userImageRepository.find({
      where: { user: { id: userId } },
      order: { created_at: 'DESC' },
    });

    // فقط اطلاعات مورد نیاز رو برگردون (مثلاً url و isMain)
    return images.map((img) => ({
      url: img.url,
      isMain: img.isMain,
      filename: img.filename,
      id: img.id,
    }));
  }

  // حذف تصویر از دیتابیس و فولدر
  async findByFilename(userId: number, filename: string) {
    return this.userImageRepository.findOne({
      where: {
        user: { id: userId },
        filename,
      },
    });
  }

  async deleteMainImageAndSetNew(
    userId: number,
    oldFilename: string,
    newMainImageId?: number,
  ) {
    const oldImage = await this.userImageRepository.findOne({
      where: { filename: oldFilename, user: { id: userId } },
    });

    if (!oldImage) {
      throw new NotFoundException('تصویر قبلی پیدا نشد');
    }

    if (newMainImageId) {
      const newImage = await this.userImageRepository.findOne({
        where: { id: newMainImageId, user: { id: userId } },
      });

      if (!newImage) {
        throw new NotFoundException('تصویر جایگزین پیدا نشد');
      }

      newImage.isMain = true;
      await this.userImageRepository.update(
        { user: { id: userId }, isMain: true },
        { isMain: false },
      );
      await this.userImageRepository.save(newImage);
    } else {
      // فقط تصویر اصلی رو false کن، تصویر پیش‌فرض در فرانت استفاده میشه
      await this.userImageRepository.update(
        { user: { id: userId }, isMain: true },
        { isMain: false },
      );
    }

    // حذف فایل‌ها
    const baseDir = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'public',
      'images',
      'users',
      `${userId}`,
    );
    const sizes = ['100', '400', '800'];
    for (const size of sizes) {
      const filePath = path.join(baseDir, size, oldImage.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await this.userImageRepository.delete({
      filename: oldFilename,
      user: { id: userId },
    });

    return {
      message: newMainImageId
        ? 'تصویر اصلی حذف و جایگزین شد'
        : 'تصویر اصلی حذف شد',
    };
  }

  async deleteImage(userId: number, filename: string) {
    const baseDir = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'public',
      'images',
      'users',
      `${userId}`,
    );
    const sizes = ['100', '400', '800'];

    for (const size of sizes) {
      const filePath = path.join(baseDir, size, filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err: unknown) {
          console.error('Error deleting file:', filePath, err);
        }
      } else {
        console.log('File not found:', filePath);
      }
    }

    // حذف از دیتابیس
    await this.userImageRepository.delete({ filename, user: { id: userId } });

    await this.userEventService.log({
      userId,
      type: EventType.PHOTO_DELETE,
      metadata: {
        filename,
      },
    });
    return { message: 'تصویر با موفقیت حذف شد' };
  }

  async setMainImage(userId: number, imageUrl: string): Promise<any> {
    // پیدا کردن تصویر فعلی
    const image = await this.userImageRepository.findOne({
      where: { url: imageUrl, user: { id: userId } },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    // ابتدا همه تصاویر اصلی دیگر را غیر فعال می‌کنیم
    await this.userImageRepository.update(
      { user: { id: userId }, isMain: true },
      { isMain: false },
    );

    // سپس تصویر جدید را به عنوان تصویر اصلی انتخاب می‌کنیم
    await this.userImageRepository.update({ id: image.id }, { isMain: true });

    await this.userEventService.log({
      userId,
      type: EventType.PROFILE_UPDATE_PHOTO_MAIN,
      metadata: {
        imageUrl,
      },
    });
    return { message: 'Image has been set as the main image' };
  }
}
