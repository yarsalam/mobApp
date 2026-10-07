import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { PhaseService } from './phase.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('phase')
export class PhaseController {
  constructor(private readonly phaseService: PhaseService) {}

  @UseGuards(JwtAuthGuard)
  @Get(':userId')
  async getPhase(@Param('userId', ParseIntPipe) userId: number) {
    return this.phaseService.getPhaseMetrics(userId);
  }
}
