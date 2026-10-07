import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RelationStatusService } from './relation-status.service';

@Controller('relation-status')
export class RelationStatusController {
  constructor(private readonly relationStatusService: RelationStatusService) {}

  @Get(':targetId')
  @UseGuards(JwtAuthGuard)
  async getRelation(@Req() req: any, @Param('targetId') targetId: number) {
    const userId = req.user.sub;
    return this.relationStatusService.getEffectiveRelation(userId, targetId);
  }
}
