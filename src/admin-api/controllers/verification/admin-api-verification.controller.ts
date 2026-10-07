import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  ParseIntPipe,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { VerificationService } from '../../../verification/verification.service';

@Controller('admin-api/verification')
@UseGuards(AdminApiGuard)
export class AdminApiVerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  /**
   * وضعیت فعلی تأیید چهره‌ی یک کاربر — برای نمایش در User360.
   */
  @Get(':userId/status')
  async getStatus(@Param('userId', ParseIntPipe) userId: number) {
    return this.verificationService.getVerificationStatus(userId);
  }

  /**
   * اجرای مجدد تأیید چهره توسط ادمین — مثلاً وقتی کاربر عکس پروفایل جدید گذاشته
   * و تیم Trust & Safety می‌خواهد دستی دوباره تأیید را اجرا کند.
   * selfie از طریق فرم آپلود می‌شود؛ عکس اصلی پروفایل خودکار از userImages گرفته می‌شود.
   */
  @Post(':userId/re-verify')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'selfie', maxCount: 1 }]))
  async reVerify(
    @Param('userId', ParseIntPipe) userId: number,
    @UploadedFiles() files: { selfie?: Express.Multer.File[] },
  ) {
    const selfieFile = files?.selfie?.[0];
    if (!selfieFile) {
      return { success: false, message: 'فایل selfie ارسال نشده است' };
    }
    return this.verificationService.requestVerification(userId, selfieFile);
  }
}
