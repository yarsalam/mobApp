import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class UserSEOSignalsService {
  private readonly logger = new Logger(UserSEOSignalsService.name);

  /**
   * Audience intelligence is intentionally unavailable until a consented,
   * privacy-preserving aggregation pipeline and minimum cohort policy exist.
   * Never turn profile hobbies, values, city counts, or private interactions
   * into public marketing claims.
   */
  async analyzeUserSignals(): Promise<null> {
    this.logger.warn(
      'Audience signals unavailable: privacy-preserving aggregation is not implemented',
    );
    return null;
  }
}
