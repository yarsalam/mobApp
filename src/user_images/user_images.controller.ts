import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Delete,
  Param,
  Req,
  UseGuards,
  NotFoundException,
  Body,
  ParseBoolPipe,
  Get,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserImageService } from './user_images.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RequestWithUser } from 'src/types/express';

@UseGuards(JwtAuthGuard)
@Controller('user-image')
export class UserImageController {
  constructor(private readonly userImageService: UserImageService) {}

  // آپلود تصویر
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('isMain', ParseBoolPipe) isMain: boolean,
    @Req() req: { user: { phone: string } }, // دریافت isMain از body
  ) {
    const phone = req.user.phone;
    const user = await this.userImageService.findUserByPhone(phone);
    if (!user) {
      throw new NotFoundException('User with this phone not found');
    }
    return await this.userImageService.createUserImage(file, user.id, isMain); // ارسال isMain به متد سرویس
  }

  // حذف تصویر
  @Delete(':filename')
  async deleteImage(
    @Param('filename') filename: string,
    @Req() req: RequestWithUser,
    @Body() body: { newMainImageId?: number },
  ) {
    const userId = req.user?.['sub'];
    const newMainImageId = body.newMainImageId;

    if (!userId) {
      throw new BadRequestException('شناسه کاربر یافت نشد');
    }

    const imageToDelete = await this.userImageService.findByFilename(
      userId,
      filename,
    );

    if (!imageToDelete) {
      throw new NotFoundException('تصویر موردنظر پیدا نشد');
    }

    if (imageToDelete.isMain) {
      return this.userImageService.deleteMainImageAndSetNew(
        userId,
        filename,
        newMainImageId,
      );
    }

    return this.userImageService.deleteImage(userId, filename);
  }

  @Post('set-main')
  async setMainImage(
    @Body('imageUrl') imageUrl: string,
    @Req() req: { user: { phone: string } },
  ) {
    const phone = req.user.phone;
    const user = await this.userImageService.findUserByPhone(phone);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return await this.userImageService.setMainImage(user.id, imageUrl);
  }

  @Get(':userId')
  async getUserImages(@Param('userId', ParseIntPipe) userId: number) {
    const images = await this.userImageService.getImagesByUserId(userId);
    return { images };
  }
}
