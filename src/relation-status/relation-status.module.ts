import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RelationStatusService } from './relation-status.service';
import { RelationStatusController } from './relation-status.controller';
import { Interaction } from 'src/interaction/entities/interaction.entity';
import { Report } from 'src/report-block/entities/report.entity';
import { Block } from 'src/report-block/entities/block.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Interaction, Block, Report])],
  controllers: [RelationStatusController],
  providers: [RelationStatusService],
  exports: [RelationStatusService],
})
export class RelationStatusModule {}
