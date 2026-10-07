import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';

import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductBundle } from './entities/product-bundle.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ProductBundle])],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
