import { Module } from '@nestjs/common';
import { UserImageService } from './user_images.service';
import { UserImageController } from './user_images.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserImage } from './entities/user_image.entity';
import { UsersModule } from 'src/users/users.module';
import { User } from 'src/users/entities/user.entity';
import { AuthModule } from 'src/auth/auth.module';
import { AiImageModule } from 'src/ai-image/ai-image.module';
import { UserEventModule } from 'src/user-event/user-event.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserImage, User]),
    UsersModule,
    AuthModule,
    AiImageModule, // وارد کردن UserModule که UserRepository را شامل می‌شود
    UserEventModule,
  ],
  controllers: [UserImageController],
  providers: [UserImageService],
})
export class UserImagesModule {}
