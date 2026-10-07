import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  BadRequestException,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from 'src/auth/decorator/get-user/get-user.decorator';
import { InteractionsService } from './interaction.service';
import { Interaction, InteractionType } from './entities/interaction.entity';
import { CurrentUser } from 'src/current-user/current-user.decorator';
import { RelationStatusService } from 'src/relation-status/relation-status.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Controller('interactions')
@UseGuards(JwtAuthGuard)
export class InteractionsController {
  constructor(
    private readonly interactionsService: InteractionsService,
    private readonly relationStatusService: RelationStatusService,
    @InjectRepository(Interaction)
    private readonly interactionRepo: Repository<Interaction>,
  ) {}

  @Post(':targetId/:type')
  async log(
    @GetUser('id') userId: number,
    @Param('targetId', ParseIntPipe) targetId: number,
    @Param('type') type: string,
  ) {
    const validTypes = ['view', 'like', 'superlike', 'skip', 'message'];
    if (!validTypes.includes(type)) {
      throw new BadRequestException('Invalid interaction type');
    }

    const result = await this.interactionsService.record(
      userId,
      targetId,
      type as InteractionType,
      { source: 'api' },
    );

    return { success: true, data: result };
  }

  @Get('sent')
  async getSent(@GetUser('id') userId: number) {
    return this.interactionsService.getUserInteractions(userId);
  }

  @Get('received')
  async getReceived(@GetUser('id') userId: number) {
    return this.interactionsService.getReceivedInteractions(userId);
  }

  @Get('status/:targetUserId')
  async getLikeStatus(
    @Req() req: any,
    @Param('targetUserId', ParseIntPipe) targetUserId: number,
  ) {
    const userId = req.user.sub;

    const [hasLiked, hasSuperLiked] = await Promise.all([
      this.interactionRepo
        .createQueryBuilder('i')
        .select('i.id')
        .where('i.senderId = :me', { me: userId })
        .andWhere('i.receiverId = :target', { target: targetUserId })
        .andWhere('i.type = :type', { type: 'like' })
        .limit(1)
        .getOne()
        .then((res) => !!res),

      this.interactionRepo
        .createQueryBuilder('i')
        .select('i.id')
        .where('i.senderId = :me', { me: userId })
        .andWhere('i.receiverId = :target', { target: targetUserId })
        .andWhere('i.type = :type', { type: 'superlike' })
        .limit(1)
        .getOne()
        .then((res) => !!res),
    ]);

    return { hasLiked, hasSuperLiked };
  }

  @Get('relation/:targetId')
  async getRelation(
    @CurrentUser('sub') userId: number,
    @Param('targetId', ParseIntPipe) targetId: number,
  ) {
    return this.relationStatusService.getEffectiveRelation(userId, targetId);
  }
}
