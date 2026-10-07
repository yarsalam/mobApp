import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { AiAssistantService } from '../../../ai-assistant/ai-assistant.service';

@Controller('admin-api/assistant')
@UseGuards(AdminApiGuard)
export class AdminApiAssistantController {
  constructor(private readonly aiAssistantService: AiAssistantService) {}

  @Get('advice/:userId')
  getAdvice(@Param('userId', ParseIntPipe) userId: number) {
    return this.aiAssistantService.getAdvice(userId);
  }

  @Get('problems/:userId')
  getProblems(@Param('userId', ParseIntPipe) userId: number) {
    return this.aiAssistantService.getUserProblems(userId);
  }

  @Get('optimization-plan/:userId')
  getOptimizationPlan(@Param('userId', ParseIntPipe) userId: number) {
    return this.aiAssistantService.getOptimizationPlan(userId);
  }

  @Get('full-analysis/:userId')
  getFullAnalysis(@Param('userId', ParseIntPipe) userId: number) {
    return this.aiAssistantService.getAdvice(userId);
  }
}
