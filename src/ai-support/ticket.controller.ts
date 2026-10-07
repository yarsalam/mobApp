// ticket.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { TicketService } from './services/ticket.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  // POST /tickets
  @Post()
  create(@Req() req: any, @Body() dto: CreateTicketDto) {
    return this.ticketService.createTicket(req.user, dto);
  }

  // GET /tickets/user/:userId
  @Get('user/:userId')
  getUserTickets(@Param('userId', ParseIntPipe) userId: number) {
    return this.ticketService.getUserTickets(userId);
  }

  // GET /tickets/:id
  @Get(':id')
  getTicket(@Param('id', ParseIntPipe) id: number) {
    return this.ticketService.getTicket(id);
  }

  // POST /tickets/:id/messages
  @Post(':id/messages')
  addMessage(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Body('content') content: string,
  ) {
    return this.ticketService.addMessage(
      id,
      req.user.id,
      content,
      'user' as any,
    );
  }

  // PATCH /tickets/:id/resolve
  @Patch(':id/resolve')
  resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body('resolution') resolution: string,
  ) {
    return this.ticketService.resolveTicket(id, resolution);
  }

  // POST /tickets/:id/feedback
  @Post(':id/feedback')
  feedback(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Body() body: { rating: number; comment?: string },
  ) {
    return this.ticketService.submitFeedback(
      id,
      req.user.id,
      body.rating,
      body.comment,
    );
  }
}
