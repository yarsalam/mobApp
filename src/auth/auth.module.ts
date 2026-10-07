import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { RecaptchaService } from '../recaptcha/recaptcha.service';
import { UserDeviceModule } from '../user-device/user-device.module';
import { UserPhonesModule } from '../user-phones/user-phones.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { RedisModule } from '../redis/redis.module';
import { OtpModule } from './otp/otp.module';
import { ChannelsModule } from './channels/channels.module';
import { TelegramModule } from './channels/telegram/telegram.module';
import { WhatsappModule } from './channels/whatsapp/whatsapp.module';
import { DevicePhoneModule } from './device-phone/device-phone.module';
import { UserEventModule } from '../user-event/user-event.module';
import { PhaseModule } from '../phase/phase.module';
import { FeatureStoreModule } from '../feature-store/feature-store.module';

// سرویس‌های جدید
import { AuthRegistrationService } from './services/auth-registration.service';
import { AuthLoginService } from './services/auth-login.service';
import { AuthProfileService } from './services/auth-profile.service';
import { DebugAuthController } from './debug-auth.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    UsersModule,
    ChannelsModule,
    PhaseModule,
    FeatureStoreModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '30d' },
    }),
    PassportModule,
    RedisModule,
    UserDeviceModule,
    OtpModule,
    TelegramModule,
    WhatsappModule,
    DevicePhoneModule,
    UserEventModule,
    UserPhonesModule,
  ],
  providers: [
    AuthService,
    AuthRegistrationService,
    AuthLoginService,
    AuthProfileService,
    JwtStrategy,
    RecaptchaService,
  ],
  controllers: [AuthController, DebugAuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
