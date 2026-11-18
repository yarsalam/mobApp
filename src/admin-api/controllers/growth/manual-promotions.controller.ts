import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { ManualPromotionService } from 'src/manual-promotions/manual-promotion.service';

@Controller('admin-api/promotions/manual')
@UseGuards(AdminApiGuard)
export class ManualPromotionsController {
  constructor(private readonly promotions: ManualPromotionService) {}

  @Get()
  list() {
    return this.promotions.listCampaigns();
  }

  @Post()
  create(@Body() body: Record<string, any>) {
    return this.promotions.createCampaign(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.promotions.updateCampaign(id, body);
  }

  @Delete(':id')
  disable(@Param('id') id: string) {
    return this.promotions.disableCampaign(id);
  }

  @Get(':id/report')
  report(@Param('id') id: string) {
    return this.promotions.getCampaignReport(id);
  }
}
