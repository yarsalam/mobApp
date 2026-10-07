// backend/src/admin-api/controllers/product/bundles.controller.ts
import { Controller, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { ProductService } from '../../../product/product.service';

@Controller('admin-api/product/bundles')
@UseGuards(AdminApiGuard)
export class BundlesController {
  constructor(private readonly productService: ProductService) {}
}
