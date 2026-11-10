import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Personality } from './entities/personality.entity';
import { Payment } from '../payments/entities/payment.entity';
import { User } from '../users/entities/user.entity';
import { Message } from '../message/entities/message.entity';
import { OpenRouterClientService } from '../ai-assistant/llm/openrouter-client.service';
import { RedisModule } from '../redis/redis.module';
import { PersonalityController } from './personality.controller';
import { PersonalityService } from './personality.service';
import { PersonalityAIClient } from './services/personality-ai-client.service';
import { PersonalityWeightService } from './services/personality-weight.service';
import { PersonalityLearningService } from './services/personality-learning.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Personality, Payment, User, Message]),
    HttpModule.register({ timeout: 5000 }),
    RedisModule,
  ],
  controllers: [PersonalityController],
  providers: [
    PersonalityService,
    PersonalityAIClient,
    PersonalityWeightService,
    PersonalityLearningService,
    OpenRouterClientService,
  ],
  exports: [PersonalityService],
})
export class PersonalityModule {}
