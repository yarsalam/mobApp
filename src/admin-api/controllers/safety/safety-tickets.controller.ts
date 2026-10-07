import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { TicketService } from '../../../ai-support/services/ticket.service';
import { MessageType } from '../../../ai-support/entities/ticket-message.entity';

@Controller('admin-api/safety/tickets')
@UseGuards(AdminApiGuard)
export class SafetyTicketsController {
  constructor(private readonly ticketService: TicketService) {}

  @Get()
  getAll(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
  ) {
    return this.ticketService.findAll({ status, priority });
  }

  @Get(':id')
  getDetail(@Param('id', ParseIntPipe) id: number) {
    return this.ticketService.getTicketDetail(id);
  }

  // ── تحلیل AI ذخیره‌شده در دیتابیس ────────────────────────────────────────
  // داده‌های aiSuggestions، sentimentAnalysis، keywords، aiConfidenceScore
  // که هنگام ایجاد تیکت توسط BullMQ ذخیره شدن رو برمیگردونه
  @Get(':id/ai-analysis')
  async getAIAnalysis(@Param('id', ParseIntPipe) id: number) {
    const ticket = await this.ticketService.getTicketDetail(id);
    if (!ticket) return null;

    return {
      ticketId: id,
      aiConfidenceScore: ticket.aiConfidenceScore,
      aiSuggestions: ticket.aiSuggestions,
      sentimentAnalysis: ticket.sentimentAnalysis,
      keywords: ticket.keywords,
      slaBreached: ticket.slaBreached,
      slaDeadline: ticket.slaDeadline,
      firstResponseAt: ticket.firstResponseAt,
    };
  }

  @Post(':id/resolve')
  resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body('resolution') resolution: string,
  ) {
    return this.ticketService.resolveTicket(id, resolution);
  }

  // ── پیام پشتیبانی (type = SUPPORT تا firstResponseAt ثبت بشه) ──────────
  @Post(':id/messages')
  addMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { userId: number; content: string },
  ) {
    return this.ticketService.addMessage(
      id,
      body.userId,
      body.content,
      MessageType.SUPPORT, // ← ادمین = support نه user
    );
  }

  // ── تحلیل مجدد: پیام جدید ادمین رو ثبت می‌کنه و BullMQ دوباره analyze میکنه
  @Post(':id/re-analyze')
  reAnalyze(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { content: string; userId: number },
  ) {
    // addMessage با status=OPEN خودکار BullMQ رو trigger میکنه
    return this.ticketService.addMessage(
      id,
      body.userId,
      body.content,
      MessageType.SUPPORT,
    );
  }
}
