import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { ProductService } from '../../../product/product.service';

@Controller('admin-api/product/bundles')
@UseGuards(AdminApiGuard)
export class BundlesController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  getAll() {
    return this.productService.getAll();
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.productService.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.productService.update(id, body);
  }

  @Delete(':id')
  disable(@Param('id', ParseIntPipe) id: number) {
    return this.productService.disable(id);
  }
}
