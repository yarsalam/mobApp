import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CompetitorSEOService {
  private readonly logger = new Logger(CompetitorSEOService.name);

  async analyzeCompetitors(): Promise<null> {
    this.logger.warn(
      'Competitor intelligence unavailable: no verified competitor data provider is configured',
    );
    return null;
  }

  async detectCompetitorChanges(): Promise<null> {
    this.logger.warn(
      'Competitor change tracking unavailable: no verified competitor snapshots exist',
    );
    return null;
  }
}
