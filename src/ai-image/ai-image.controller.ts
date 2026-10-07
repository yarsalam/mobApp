import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  ParseFilePipeBuilder,
  HttpStatus,
  Get,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AiImageService } from './ai-image.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CurrentUser } from 'src/current-user/current-user.decorator';

@Controller('ai-image')
export class AiImageController {
  constructor(private readonly aiImageService: AiImageService) {}

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @CurrentUser() user: any,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType:
            /(apng|avif|jpg|jpeg|jfif|pjpeg|pjp|png|webp|bmp|cur|tif|tiff)$/,
        })
        .addMaxSizeValidator({
          maxSize: 5 * 1024 * 1024,
        })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
    )
    file: Express.Multer.File,
  ) {
    return this.aiImageService.upload({
      userId: user.sub,
      path: file.path,
      filename: file.filename,
      url: file.path,
      size: file.size.toString(),
    });
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard)
  async getUserImages(@Param('userId', ParseIntPipe) userId: number) {
    return this.aiImageService.findByUser(userId);
  }
}
