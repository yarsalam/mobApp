import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AiAssistantService } from './ai-assistant.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { IcebreakersDto } from './dto/icebreakers.dto';
import { GetUser } from 'src/auth/decorator/get-user/get-user.decorator';

/**
 * همه endpointها با JwtAuthGuard محافظت می‌شوند.
 * userId همیشه از JWT گرفته می‌شود — نه از URL param.
 */
@Controller('ai-assistant')
@UseGuards(JwtAuthGuard) // ← Guard روی کل controller
export class AiAssistantController {
  constructor(private readonly assistant: AiAssistantService) {}

  // ─── Advice ───────────────────────────────────────────────────────────────

  /** GET /ai-assistant/advice */
  @Get('advice')
  async getAdvice(@GetUser('id') userId: number) {
    return this.assistant.getAdvice(userId);
  }

  /** GET /ai-assistant/guidance */
  @Get('guidance')
  async getNextGuidance(@GetUser('id') userId: number) {
    return this.assistant.getNextGuidance(userId);
  }

  /** GET /ai-assistant/optimization-plan */
  @Get('optimization-plan')
  async getOptimizationPlan(@GetUser('id') userId: number) {
    return this.assistant.getOptimizationPlan(userId);
  }

  /** GET /ai-assistant/problems */
  @Get('problems')
  async getUserProblems(@GetUser('id') userId: number) {
    return this.assistant.getUserProblems(userId);
  }

  // ─── Conversation ─────────────────────────────────────────────────────────

  /** POST /ai-assistant/conversations */
  @Post('conversations')
  async startConversation(
    @GetUser('id') userId: number,
    @Body() body: { initialMessage?: string },
  ) {
    return this.assistant.startConversation(userId, body.initialMessage);
  }

  /** GET /ai-assistant/conversations */
  @Get('conversations')
  async listConversations(@GetUser('id') userId: number) {
    return this.assistant.listConversationsForUser(userId);
  }

  /** GET /ai-assistant/conversations/:convId */
  @Get('conversations/:convId')
  async getConversation(
    @GetUser('id') userId: number,
    @Param('convId', ParseIntPipe) convId: number,
  ) {
    // ownership check داخل service انجام می‌شود
    return this.assistant.getConversation(convId, userId);
  }

  /** POST /ai-assistant/conversations/:convId/messages */
  @Post('conversations/:convId/messages')
  async sendMessage(
    @GetUser('id') userId: number,
    @Param('convId', ParseIntPipe) convId: number,
    @Body() dto: SendMessageDto,
  ) {
    return this.assistant.userSendsMessage(convId, userId, dto.message);
  }

  // ─── Premium Features ─────────────────────────────────────────────────────

  /** POST /ai-assistant/icebreakers */
  @Post('icebreakers')
  async getIcebreakers(
    @GetUser('id') userId: number,
    @Body() dto: IcebreakersDto,
  ) {
    return this.assistant.getIcebreakers(userId, dto.targetUserId);
  }

  /**
   * POST /ai-assistant/suggest-reply
   * ← Fix: convId اضافه شد تا history مکالمه در دسترس باشد
   */
  @Post('suggest-reply')
  async suggestReply(
    @GetUser('id') userId: number,
    @Body() body: { convId: number; message: string },
  ) {
    const reply = await this.assistant.suggestReply(
      userId,
      body.convId,
      body.message,
    );
    return { reply };
  }
}
