import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Interaction } from './entities/interaction.entity';
import { InteractionsController } from './interaction.controller';
import { InteractionsService } from './interaction.service';
import { ReportBlockModule } from 'src/report-block/report-block.module';
import { User } from 'src/users/entities/user.entity';
import { Message } from 'src/message/entities/message.entity';
import { UserEventModule } from 'src/user-event/user-event.module';
import { PhaseModule } from 'src/phase/phase.module';
import { PersonalityModule } from 'src/personality/personality.module';
import { FeatureStoreModule } from 'src/feature-store/feature-store.module';
import { RelationStatusModule } from 'src/relation-status/relation-status.module';
import { RevenueScorerService } from 'src/suggestion/scoring/revenue-scorer.service';
import { DiversityOptimizerService } from 'src/suggestion/optimization/diversity-optimizer.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Interaction, User, Message]),
    PhaseModule,
    ReportBlockModule,
    UserEventModule,
    PersonalityModule,
    FeatureStoreModule,
    RelationStatusModule,
  ],
  controllers: [InteractionsController],
  providers: [
    InteractionsService,
    RevenueScorerService,
    DiversityOptimizerService,
  ],
  exports: [InteractionsService],
})
export class InteractionsModule {}
