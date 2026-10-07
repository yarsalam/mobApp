import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import databaseConfig from './config/database.config';
import corsConfig from './config/cors.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { User } from './users/entities/user.entity';
import { ProfileVisitorsModule } from './profile-visitors/profile-visitors.module';
import { UserImagesModule } from './user_images/user_images.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { MessageModule } from './message/message.module';
import { NotificationModule } from './notification/notification.module';
import { UserDeviceModule } from './user-device/user-device.module';
import { PaymentsModule } from './payments/payments.module';
import { UserPhonesModule } from './user-phones/user-phones.module';
import { SuggestionModule } from './suggestion/suggestion.module';
import { ReportBlockModule } from './report-block/report-block.module';
import { InteractionsModule } from './interaction/interaction.module';
import { PersonalityModule } from './personality/personality.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AiModule } from './ai/ai.module';
import { AiAssistantModule } from './ai-assistant/ai-assistant.module';
import { QueuesModule } from './queues/queues.module';
import { AiFeedbackModule } from './ai-feedback/ai-feedback.module';
import { AiImageModule } from './ai-image/ai-image.module';
import { RedisModule } from './redis/redis.module';
import { ClientInfoMiddleware } from './common/middleware/client-info.middleware';
import { TelegramModule } from './auth/channels/telegram/telegram.module';
import { WhatsappModule } from './auth/channels/whatsapp/whatsapp.module';
import { UserEventModule } from './user-event/user-event.module';
import { UserMetricsModule } from './user-metrics/user-metrics.module';
import { ProductModule } from './product/product.module';
import { FeedModule } from './feed/feed.module';
import { SEOModule } from './seo/seo.module';
import { AiSupportModule } from './ai-support/ai-support.module';
import { FeatureStoreRevenueModule } from './feature-store-rvenue/feature-store-rvenue.module';
import { SocialListenerModule } from './social-listener/social-listener.module';
import { FeatureStoreModule } from './feature-store/feature-store.module';
import { RelationStatusModule } from './relation-status/relation-status.module';
import { DebugModule } from './debug/debug.module';
import { RetrievalModule } from './suggestion/retrieval/retrieval.module';
import { AdminApiModule } from './admin-api/admin-api.module';
import { PhaseModule } from './phase/phase.module';
import { HealthController } from './app.controller';
import { QdrantModule } from './qdrant/qdrant.module';
import { RedisService } from './redis/redis.service';
import { RequestTimingMiddleware } from './common/middleware/request-timing.middleware';
import { PerformanceMetricsService } from './common/services/performance-metrics.service';
import { AiOpsModule } from './ai-ops/ai-ops.module';
import { OpsModule } from './ops/ops.module';
import { TraceInterceptor } from './ops/trace.interceptor';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BadgeModule } from './badge/badge.module';
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: '/app/public',
      serveRoot: '/',
    }),
    ConfigModule.forRoot({
      load: [databaseConfig, corsConfig],
      isGlobal: true,
    }),
    TypeOrmModule.forRoot(databaseConfig()),
    TypeOrmModule.forFeature([User]),
    AuthModule,
    UsersModule,
    UserImagesModule,
    ProfileVisitorsModule,
    NotificationModule,
    UserDeviceModule,
    PaymentsModule,
    MessageModule,
    UserPhonesModule,
    SuggestionModule,
    ReportBlockModule,
    PhaseModule,
    InteractionsModule,
    PersonalityModule,
    AiModule,
    AiAssistantModule,
    QueuesModule,
    AiFeedbackModule,
    AiImageModule,
    RedisModule,
    TelegramModule,
    WhatsappModule,
    UserEventModule,
    UserMetricsModule,
    ProductModule,
    FeedModule,
    SEOModule,
    AiSupportModule,
    FeatureStoreRevenueModule,
    SocialListenerModule,
    FeatureStoreModule,
    RelationStatusModule,
    DebugModule,
    RetrievalModule,
    AdminApiModule,
    QdrantModule,
    AiOpsModule,
    OpsModule,
    BadgeModule,
  ],
  providers: [RedisService, PerformanceMetricsService, TraceInterceptor],

  exports: [RedisService],
  controllers: [HealthController],
})
// export class AppModule {}
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ClientInfoMiddleware, RequestTimingMiddleware) // هر دو با هم
      .forRoutes('*');
  }
}
