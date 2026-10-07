import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10_000,
      maxRedirects: 3,
    }),
  ],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
