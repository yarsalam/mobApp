import { Module } from '@nestjs/common';
import { DebugService } from './debug.service';
import { DebugController } from './debug.controller';
import { RetrievalModule } from 'src/suggestion/retrieval/retrieval.module';
import { SuggestionModule } from 'src/suggestion/suggestion.module';
import { FeedModule } from 'src/feed/feed.module';
import { RelationStatusModule } from 'src/relation-status/relation-status.module';
import { DevelopmentOnlyGuard } from 'src/common/guards/development-only.guard';

@Module({
  imports: [
    RetrievalModule,
    SuggestionModule,
    FeedModule,
    RelationStatusModule,
  ],
  controllers: [DebugController],
  providers: [DebugService, DevelopmentOnlyGuard],
})
export class DebugModule {}
