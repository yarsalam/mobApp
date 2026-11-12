import { Controller, Post, Body, UseGuards, GoneException } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';

@Controller('admin-api/product/experiments')
@UseGuards(AdminApiGuard)
export class ExperimentsController {
  @Post('run-ab')
  runAB(
    @Body() _body: { userId: number; variantA: string; variantB: string },
  ) {
    throw new GoneException(
      'A/B assignments are issued by the Feed promotion engine only when the isolated staging experiment flag is enabled. This endpoint no longer sends empty feature vectors.',
    );
  }
}
