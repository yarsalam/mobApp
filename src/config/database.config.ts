import { registerAs } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity'; // مسیر فایل مدل یوزر
import { ProfileVisitor } from 'src/profile-visitors/entities/profile-visitor.entity';
import { UserImage } from 'src/user_images/entities/user_image.entity';
import { Message } from 'src/message/entities/message.entity';
import { AppNotification } from 'src/notification/entities/notification.entity';
import { UserDevice } from 'src/user-device/entities/user-device.entity';
import { UserPhone } from 'src/user-phones/entities/user-phone.entity';
import { Interaction } from 'src/interaction/entities/interaction.entity';
import { ReportBlock } from 'src/report-block/entities/report-block.entity';
import { AssistantConversation } from 'src/ai-assistant/entities/assistant-conversation.entity';
import { AssistantMessage } from 'src/ai-assistant/entities/assistant-message.entity';
import { AiFeedback } from 'src/ai-feedback/entities/ai-feedback.entity';
import { AiImage } from 'src/ai-image/entities/ai-image.entity';
import { Block } from 'src/report-block/entities/block.entity';
import { SuggestionEntity } from 'src/suggestion/entities/suggestion.entity';
import { Report } from 'src/report-block/entities/report.entity';
import { DevicePhone } from 'src/auth/device-phone/entities/device-phone.entity';
import { UserBoost } from 'src/payments/boosts/entities/user-boost.entity';
import { UserPhase } from 'src/phase/entities/user-phase.entity';
import { UserVip } from 'src/payments/vip/entities/vip.entity';
import { UserCredits } from 'src/payments/credits/entities/user-credits.entity';
import { ProductBundle } from 'src/product/entities/product-bundle.entity';
import { CompetitorData } from 'src/seo/entities/competitor-data.entity';
import { SEOActivity } from 'src/seo/entities/seo-activity.entity';
import { SEOMetrics } from 'src/seo/entities/seo-metrics.entity';
import { SEORecommendation } from 'src/seo/entities/seo-recommendation.entity';
import { TicketFeedback } from 'src/ai-support/entities/ticket-feedback.entity';
import { TicketMessage } from 'src/ai-support/entities/ticket-message.entity';
import { SupportTicket } from 'src/ai-support/entities/ticket.entity';
import { UserFeatureSnapshot } from 'src/feature-store/entities/user-feature.entity';
import { ModerationLog } from 'src/moderation/entities/moderation-log.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { ArchiveRequest } from 'src/user-event/entities/archive-request.entity';
import { PartitionedEvent } from 'src/user-event/entities/partitioned-event.entity';
import { RequestLog } from 'src/ops/entities/request-log.entity';
import { TicketEvent } from 'src/ai-support/entities/ticket-event.entity';
import { Personality } from 'src/personality/entities/personality.entity';
import { UserDailyMetrics } from 'src/user-metrics/entities/user-daily-metrics.entity';
import { UserWallet } from 'src/payments/wallet/entities/user-wallet.entity';

const logger = new Logger('DatabaseConfig');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and set it.`,
    );
  }
  return value;
}

function resolveLogging(): TypeOrmModuleOptions['logging'] {
  if (process.env.DB_LOGGING === 'true') return true;
  if (process.env.DB_LOGGING === 'false') return false;
  return process.env.NODE_ENV === 'production' ? ['error', 'warn'] : true;
}

function resolveSynchronize(): boolean {
  const sync = process.env.DB_SYNC === 'true';
  if (sync && process.env.NODE_ENV === 'production') {
    logger.warn(
      '⚠️  DB_SYNC=true while NODE_ENV=production. TypeORM will attempt to ' +
        'auto-alter the database schema on every restart. Disable this and ' +
        'use migrations once the schema is stable.',
    );
  }
  return sync;
}

// function resolveSsl(): TypeOrmModuleOptions['ssl'] {
//   if (process.env.DB_SSL !== 'true') return undefined;
//   return {
//     rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
//   };
// }

export default registerAs('database', (): TypeOrmModuleOptions => ({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT ?? '3306', 10),
  username: requireEnv('DB_USER'),
  password: requireEnv('DB_PASS'),
  database: requireEnv('DB_NAME'),
  charset: 'utf8mb4',
  entities: [
    User,
    ProfileVisitor,
    UserImage,
    Message,
    AppNotification,
    UserDevice,
    UserPhone,
    Interaction,
    ReportBlock,
    Personality,
    Report,
    UserWallet,
    AssistantConversation,
    AssistantMessage,
    AiFeedback,
    AiImage,
    Block,
    SuggestionEntity,
    DevicePhone,
    UserBoost,
    UserCredits,
    UserPhase,
    UserVip,
    UserDailyMetrics,
    PartitionedEvent,
    ProductBundle,
    CompetitorData,
    SEOMetrics,
    SEORecommendation,
    TicketFeedback,
    TicketMessage,
    SupportTicket,
    TicketEvent,
    UserFeatureSnapshot,
    ModerationLog,
    Payment,
    SEOActivity,
    ArchiveRequest,
    RequestLog,
  ],
  synchronize: resolveSynchronize(),
  // logging: resolveLogging(),
  logging: false,
  // ssl: resolveSsl(),
  extra: {
    connectionLimit: parseInt(process.env.DB_POOL_SIZE ?? '10', 10),
  },
  retryAttempts: 10,
  retryDelay: 3000,
}));
