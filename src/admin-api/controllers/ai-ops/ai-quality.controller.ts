import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { AiOpsService } from '../../../ai-ops/ai-ops.service';

@Controller('admin-api/ai-ops')
@UseGuards(AdminApiGuard)
export class AiQualityController {
  constructor(private readonly aiOpsService: AiOpsService) {}

  @Get('overview')
  async getOverview() {
    return this.aiOpsService.getOverview();
  }
}
