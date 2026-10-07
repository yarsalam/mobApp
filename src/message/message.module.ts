import { forwardRef, Module } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from 'src/notification/notification.module';
import { Message } from './entities/message.entity';
import { AppNotification } from 'src/notification/entities/notification.entity';
import { User } from 'src/users/entities/user.entity';
import { UserEventModule } from 'src/user-event/user-event.module';
import { ModerationModule } from 'src/moderation/moderation.module';
import { CreditsModule } from 'src/payments/credits/credits.module';
import { PhaseModule } from 'src/phase/phase.module';
import { SuggestionModule } from 'src/suggestion/suggestion.module';
import { FeatureStoreModule } from 'src/feature-store/feature-store.module';
import { RelationStatusModule } from 'src/relation-status/relation-status.module';
import { ChatGateway } from './chat.gateway';
import { PaywallModule } from 'src/payments/paywall/paywall.module';
import { JwtModule } from '@nestjs/jwt';
import { PersonalityModule } from 'src/personality/personality.module';

@Module({
  controllers: [MessageController],
  providers: [MessageService, ChatGateway],
  imports: [
    TypeOrmModule.forFeature([Message, AppNotification, User]),
    PhaseModule,
    NotificationModule,
    UserEventModule,
    ModerationModule,
    CreditsModule,
    SuggestionModule,
    FeatureStoreModule,
    RelationStatusModule,
    PaywallModule,
    JwtModule,
    PersonalityModule,
  ],
  exports: [MessageService, TypeOrmModule],
})
export class MessageModule {}
