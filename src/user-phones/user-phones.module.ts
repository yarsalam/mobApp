import { Module } from '@nestjs/common';
import { UserPhonesService } from './user-phones.service';
import { UserPhonesController } from './user-phones.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserPhone } from './entities/user-phone.entity';
import { User } from 'src/users/entities/user.entity';
import { RedisModule } from 'src/redis/redis.module';
import { TelegramModule } from 'src/auth/channels/telegram/telegram.module';
import { WhatsappModule } from 'src/auth/channels/whatsapp/whatsapp.module';
import { UserEventModule } from 'src/user-event/user-event.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserPhone, User]),
    RedisModule,
    TelegramModule,
    WhatsappModule,
    UserEventModule,
    UsersModule,
  ],
  controllers: [UserPhonesController],
  providers: [UserPhonesService],
  exports: [UserPhonesService],
})
export class UserPhonesModule {}
