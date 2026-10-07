import {
  Controller,
  Post,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { BoostService } from './boosts.service';
import { AdminApiGuard } from 'src/admin-api/guards/api-key.guard';

@Controller('boost')
export class BoostController {
  constructor(private readonly boostService: BoostService) {}

  @Post('grant-free/:userId')
  @UseGuards(AdminApiGuard)
  async grantFreeOnce(@Param('userId', ParseIntPipe) userId: number) {
    await this.boostService.grantFreeOnce(userId);
    return { success: true, userId };
  }
}
