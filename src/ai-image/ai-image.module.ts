import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AiImageService } from './ai-image.service';
import { AiImageController } from './ai-image.controller';
import { AiImageProcessor } from './ai-image.processor';
import { AiImage } from './entities/ai-image.entity';
import { UserEventModule } from 'src/user-event/user-event.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiImage]),
    BullModule.registerQueue({ name: 'ai-image' }),
    UserEventModule,
  ],
  controllers: [AiImageController],
  providers: [
    AiImageService,
    AiImageProcessor, // رجیستر processor
  ],
  exports: [AiImageService],
})
export class AiImageModule {}
