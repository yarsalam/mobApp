import { forwardRef, Module } from '@nestjs/common';
import { OtpModule } from '../../otp/otp.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { RedisModule } from 'src/redis/redis.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [OtpModule, RedisModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsappModule {}
