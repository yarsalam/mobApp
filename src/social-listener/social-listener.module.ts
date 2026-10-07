import { Module } from '@nestjs/common';
import { SocialListenerService } from './social-listener.service';
import { SocialListenerController } from './social-listener.controller';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'seo-analysis' }), // 🆕
    HttpModule,
  ],
  controllers: [SocialListenerController],
  providers: [SocialListenerService],
})
export class SocialListenerModule {}
