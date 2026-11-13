import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';

import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductBundle } from './entities/product-bundle.entity';
import { PricingExperimentModule } from '../pricing-experiments/pricing-experiment.module';

@Module({
  imports: [TypeOrmModule.forFeature([ProductBundle]), PricingExperimentModule],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
