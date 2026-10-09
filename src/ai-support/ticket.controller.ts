import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  ParseIntPipe,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { TicketService } from './services/ticket.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

type AuthenticatedRequest = {
  user: {
    id?: number;
    sub?: number;
  };
};

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  private getUserId(req: AuthenticatedRequest): number {
    const id = Number(req.user?.id ?? req.user?.sub);

    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new ForbiddenException('Invalid authenticated user');
    }

    return id;
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTicketDto) {
    return this.ticketService.createTicket({ id: this.getUserId(req) }, dto);
  }

  // کاربر فقط تیکت‌های خودش را می‌بیند.
  @Get('me')
  getMyTickets(@Req() req: AuthenticatedRequest) {
    return this.ticketService.getUserTickets(this.getUserId(req));
  }

  // دریافت تیکت فقط با کنترل مالکیت
  @Get(':id')
  getTicket(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ticketService.getTicketForUser(id, this.getUserId(req));
  }

  @Post(':id/messages')
  addMessage(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
    @Body('content') content: string,
  ) {
    return this.ticketService.addUserMessage(id, this.getUserId(req), content);
  }

  @Post(':id/feedback')
  feedback(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
    @Body() body: { rating: number; comment?: string },
  ) {
    return this.ticketService.submitFeedback(
      id,
      this.getUserId(req),
      body.rating,
      body.comment,
    );
  }
}
