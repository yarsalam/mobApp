import { Controller, Post } from '@nestjs/common';
import { FeatureStoreService } from './feature-store.service';

@Controller('feature-store')
export class FeatureStoreController {
  constructor(private readonly featureStoreService: FeatureStoreService) {}

  @Post('refresh')
  async refresh() {
    await this.featureStoreService.refreshAllFeatures();
    return { status: 'done' };
  }
}
