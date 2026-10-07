import { Module } from '@nestjs/common';
import { SuggestionService } from './suggestion.service';
import { SuggestionController } from './suggestion.controller';
import { UsersModule } from 'src/users/users.module';
import { ReportBlockModule } from 'src/report-block/report-block.module';
import { InteractionsModule } from 'src/interaction/interaction.module';
import { PersonalityModule } from 'src/personality/personality.module';
import { AiModule } from 'src/ai/ai.module';
import { UserEventModule } from 'src/user-event/user-event.module';
import { RedisModule } from 'src/redis/redis.module';
import { VectorSearchService } from './retrieval/vector-search.service';
import { RevenueScorerService } from './scoring/revenue-scorer.service';
import { DiversityOptimizerService } from './optimization/diversity-optimizer.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserFeatureSnapshot } from 'src/feature-store/entities/user-feature.entity';
import { RelationStatusModule } from 'src/relation-status/relation-status.module';
import { FeatureStoreModule } from 'src/feature-store/feature-store.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserFeatureSnapshot]),
    UsersModule,
    ReportBlockModule,
    InteractionsModule,
    PersonalityModule,
    AiModule,
    UserEventModule,
    RedisModule,
    RelationStatusModule,
    FeatureStoreModule,
  ],
  providers: [
    SuggestionService,
    VectorSearchService,
    RevenueScorerService,
    DiversityOptimizerService,
  ],

  controllers: [SuggestionController],
  exports: [SuggestionService, RevenueScorerService],
})
export class SuggestionModule {}
