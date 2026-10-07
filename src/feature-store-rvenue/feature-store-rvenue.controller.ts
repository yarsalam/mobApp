import { Controller } from '@nestjs/common';
import { FeatureStoreRevenueService } from './feature-store-rvenue.service';

@Controller('feature-store-rvenue')
export class FeatureStoreRvenueController {
  constructor(
    private readonly featureStoreRvenueService: FeatureStoreRevenueService,
  ) {}
}
