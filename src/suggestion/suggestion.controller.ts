import { Controller, Get, Query, Post, Body, UseGuards } from '@nestjs/common';
import { SuggestionService } from './suggestion.service';
import { UserEventService } from 'src/user-event/user-event.service';
import { GetUser } from 'src/auth/decorator/get-user/get-user.decorator';
import { EventType } from 'src/user-event/type/event-type.enum';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('suggestions')
@UseGuards(JwtAuthGuard)
export class SuggestionController {
  constructor(
    private readonly suggestionService: SuggestionService,
    private readonly userEventService: UserEventService,
  ) {}

  @Get()
  async getSuggestions(
    @GetUser('id') userId: number,
    @Query('limit') limit?: string,
    @Query('city') city?: string,
  ) {
    const lim = limit ? Number(limit) : undefined;
    return await this.suggestionService.getSuggestionsForUser(userId, {
      limit: lim,
      city,
    });
  }

  @Post('accept-suggestion')
  async acceptSuggestion(
    @GetUser('id') userId: number,
    @Body() body: { suggestionId: number; rank: number },
  ) {
    await this.userEventService.log({
      userId,
      type: EventType.AI_SUGGESTION_ACCEPTED,
      targetUserId: body.suggestionId,
      metadata: {
        rank: body.rank,
        source: 'suggestion_list',
      },
    });
    return { success: true };
  }
}
