import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThan } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SupportTicket, TicketStatus } from '../entities/ticket.entity';
import { TicketMessage, MessageType } from '../entities/ticket-message.entity';
import { TicketFeedback } from '../entities/ticket-feedback.entity';
import { TicketEvent, TicketEventType } from '../entities/ticket-event.entity';
import { CreateTicketDto } from '../dto/create-ticket.dto';
import { User } from '../../users/entities/user.entity';
import { UserEventService } from '../../user-event/user-event.service';
import { EventType } from 'src/user-event/type/event-type.enum';
import { DataSource } from 'typeorm';

@Injectable()
export class TicketService {
  private readonly logger = new Logger(TicketService.name);
  private readonly aiServiceUrl =
    process.env.AI_SUPPORT_URL || 'http://ai_support:8016';

  constructor(
    @InjectRepository(SupportTicket)
    private ticketRepo: Repository<SupportTicket>,
    @InjectRepository(TicketMessage)
    private messageRepo: Repository<TicketMessage>,
    @InjectRepository(TicketFeedback)
    private feedbackRepo: Repository<TicketFeedback>,
    @InjectRepository(TicketEvent) private eventRepo: Repository<TicketEvent>,
    @InjectQueue('ai-support') private aiQueue: Queue,
    private userEventService: UserEventService,
    private httpService: HttpService,
    private readonly dataSource: DataSource,
  ) {
    console.log(
      'ENTITIES:',
      this.dataSource.entityMetadatas.map((m) => m.name),
    );
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async createTicket(
    user: { id?: number; sub?: number },
    dto: CreateTicketDto,
  ): Promise<SupportTicket> {
    const userId = user.id ?? user.sub;

    if (!userId) {
      throw new NotFoundException('User id not found in JWT payload');
    }

    const ticket = this.ticketRepo.create({
      user: { id: userId } as User,
      title: dto.title,
      description: dto.description,
      category: dto.category,
      metadata: dto.metadata ?? {},
      status: TicketStatus.OPEN,
    });

    this.logger.warn('STEP 1');

    const saved = await this.ticketRepo.save(ticket);

    this.logger.warn('STEP 2');

    await this.messageRepo.save(
      this.messageRepo.create({
        ticket: saved,
        sender: { id: userId } as User,
        type: MessageType.USER,
        content: dto.description,
      }),
    );

    this.logger.warn('STEP 3');

    await this.eventRepo.save(
      this.eventRepo.create({
        ticketId: saved.id,
        type: TicketEventType.CREATED,
        actorId: userId,
      }),
    );

    this.logger.warn('STEP 4');

    await Promise.all([
      this.userEventService.log({
        userId,
        type: EventType.TICKET_CREATED,
        metadata: {
          ticketId: saved.id,
          category: dto.category,
        },
      }),

      this.aiQueue.add('analyze-ticket', {
        ticketId: saved.id,
        content: dto.description,
        userId,
        userTier: (user as any)?.tier ?? 'free',
        totalPurchases: (user as any)?.totalPurchases ?? 0,
      }),
    ]);
    this.logger.warn('STEP 5');

    return saved;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async getTicket(ticketId: number): Promise<SupportTicket> {
    const ticket = await this.ticketRepo.findOne({
      where: { id: ticketId },
      relations: ['user', 'messages', 'messages.sender'],
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async getUserTickets(userId: number): Promise<SupportTicket[]> {
    return this.ticketRepo.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
    });
  }

  async getTicketTimeline(ticketId: number): Promise<TicketEvent[]> {
    return this.eventRepo.find({
      where: { ticketId },
      order: { createdAt: 'ASC' },
    });
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  async addMessage(
    ticketId: number,
    userId: number,
    content: string,
    type: MessageType = MessageType.USER,
  ): Promise<TicketMessage> {
    const ticket = await this.ticketRepo.findOne({
      where: { id: ticketId },
      relations: ['user'],
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const message = await this.messageRepo.save(
      this.messageRepo.create({
        ticket,
        sender: { id: userId } as User,
        type,
        content,
      }),
    );

    // Record first response time if this is a support reply
    if (type === MessageType.SUPPORT && !ticket.firstResponseAt) {
      await this.ticketRepo.update(ticketId, { firstResponseAt: new Date() });
    }

    await this.eventRepo.save(
      this.eventRepo.create({
        ticketId,
        type:
          type === MessageType.USER
            ? TicketEventType.USER_REPLIED
            : TicketEventType.AGENT_REPLIED,
        actorId: userId,
      }),
    );

    if (ticket.status === TicketStatus.OPEN) {
      await this.aiQueue.add('analyze-ticket', {
        ticketId,
        content,
        userId,
        isUpdate: true,
      });
    }

    return message;
  }

  // ── Assignment ─────────────────────────────────────────────────────────────

  async assignTicket(
    ticketId: number,
    agentId: number,
  ): Promise<SupportTicket> {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    await this.ticketRepo.update(ticketId, {
      assignedToId: agentId,
      assignedAt: new Date(),
      status: TicketStatus.IN_PROGRESS,
    });

    await this.eventRepo.save(
      this.eventRepo.create({
        ticketId,
        type: TicketEventType.ASSIGNED,
        actorId: agentId,
        meta: { agentId },
      }),
    );

    // ← اضافه کن
    const updated = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!updated) throw new NotFoundException('Ticket not found after update');
    return updated;
  }

  // ── Resolve ────────────────────────────────────────────────────────────────

  async resolveTicket(
    ticketId: number,
    resolution: string,
  ): Promise<SupportTicket> {
    const ticket = await this.ticketRepo.findOne({
      where: { id: ticketId },
      relations: ['user'],
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    await this.ticketRepo.update(ticketId, {
      status: TicketStatus.RESOLVED,
      resolvedAt: new Date(),
    });

    await this.messageRepo.save(
      this.messageRepo.create({
        ticket: { id: ticketId } as any,
        type: MessageType.SYSTEM,
        content: `✅ تیکت حل شد: ${resolution}`,
      }),
    );

    await this.eventRepo.save(
      this.eventRepo.create({
        ticketId,
        type: TicketEventType.RESOLVED,
        meta: { resolution },
      }),
    );

    // ← اضافه کن
    const updated = await this.ticketRepo.findOne({
      where: { id: ticketId },
      relations: ['user'],
    });
    if (!updated) throw new NotFoundException('Ticket not found after update');
    return updated;
  }

  // ── Feedback ───────────────────────────────────────────────────────────────

  async submitFeedback(
    ticketId: number,
    userId: number,
    rating: number,
    comment?: string,
  ): Promise<TicketFeedback> {
    const ticket = await this.ticketRepo.findOne({
      where: { id: ticketId },
      relations: ['user'],
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const resolutionTime = ticket.resolvedAt
      ? Math.round(
          (ticket.resolvedAt.getTime() - ticket.createdAt.getTime()) / 60000,
        )
      : null;

    const saved = await this.feedbackRepo.save(
      this.feedbackRepo.create({
        ticket,
        user: { id: userId } as User,
        rating,
        comment,
        resolutionTime,
      }),
    );

    await Promise.all([
      this.aiQueue.add('ticket-feedback', {
        ticketId,
        rating,
        comment,
        resolutionTime,
        ticketData: ticket,
      }),
      this.userEventService.log({
        userId,
        type: EventType.TICKET_FEEDBACK,
        metadata: { ticketId, rating },
      }),
    ]);

    return saved;
  }

  // ── SLA Cron ───────────────────────────────────────────────────────────────

  /** هر 15 دقیقه تیکت‌های بیش از deadline را SLA-breached می‌کند */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkSlaBreaches() {
    const breached = await this.ticketRepo.find({
      where: {
        slaBreached: false,
        slaDeadline: LessThan(new Date()),
        status: TicketStatus.OPEN,
      },
    });

    for (const ticket of breached) {
      await this.ticketRepo.update(ticket.id, { slaBreached: true });
      await this.eventRepo.save(
        this.eventRepo.create({
          ticketId: ticket.id,
          type: TicketEventType.SLA_BREACHED,
        }),
      );
      this.logger.warn(`SLA breached for ticket #${ticket.id}`);
    }
  }

  // ── Admin queries ──────────────────────────────────────────────────────────

  async findAll(filter: {
    status?: string;
    priority?: string;
    assignedToId?: number;
    slaBreached?: boolean;
  }) {
    const q = this.ticketRepo
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.user', 'user');

    if (filter.status)
      q.andWhere('ticket.status = :status', { status: filter.status });
    if (filter.priority)
      q.andWhere('ticket.priority = :priority', { priority: filter.priority });
    if (filter.assignedToId !== undefined)
      q.andWhere('ticket.assignedToId = :aid', { aid: filter.assignedToId });
    if (filter.slaBreached !== undefined)
      q.andWhere('ticket.slaBreached = :sb', { sb: filter.slaBreached });

    return q.orderBy('ticket.createdAt', 'DESC').getMany();
  }

  async getTicketDetail(id: number) {
    return this.ticketRepo.findOne({
      where: { id },
      relations: ['user', 'messages'],
    });
  }

  async getDashboardStats() {
    const [open, inProgress, resolved, slaBreached, avgResolution] =
      await Promise.all([
        this.ticketRepo.count({ where: { status: TicketStatus.OPEN } }),
        this.ticketRepo.count({ where: { status: TicketStatus.IN_PROGRESS } }),
        this.ticketRepo.count({ where: { status: TicketStatus.RESOLVED } }),
        this.ticketRepo.count({
          where: { slaBreached: true, status: TicketStatus.OPEN },
        }),
        this.ticketRepo
          .createQueryBuilder('t')
          .select(
            `AVG(EXTRACT(EPOCH FROM (t."resolvedAt" - t."createdAt")) / 3600)`,
            'avgHours',
          )
          .where('t."resolvedAt" IS NOT NULL')
          .getRawOne(),
      ]);

    return {
      open,
      inProgress,
      resolved,
      slaBreached,
      avgResolutionHours: parseFloat(avgResolution?.avgHours ?? '0').toFixed(1),
    };
  }

  async getSEOInsights(): Promise<any> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(`${this.aiServiceUrl}/api/seo-insights`),
      );
      return data;
    } catch {
      return null;
    }
  }

  // داخل TicketService:

  async getTicketForUser(
    ticketId: number,
    userId: number,
  ): Promise<SupportTicket> {
    const ticket = await this.ticketRepo.findOne({
      where: {
        id: ticketId,
        user: { id: userId },
      },
      relations: ['messages', 'messages.sender'],
    });

    // برای جلوگیری از افشای وجود تیکت متعلق به دیگران
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  async addUserMessage(
    ticketId: number,
    userId: number,
    content: string,
  ): Promise<TicketMessage> {
    const normalized = typeof content === 'string' ? content.trim() : '';

    if (!normalized || normalized.length > 5000) {
      throw new BadRequestException(
        'Message must contain 1 to 5000 characters',
      );
    }

    const ticket = await this.ticketRepo.findOne({
      where: {
        id: ticketId,
        user: { id: userId },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (
      ticket.status === TicketStatus.RESOLVED ||
      ticket.status === TicketStatus.CLOSED
    ) {
      throw new BadRequestException(
        'This ticket is no longer accepting messages',
      );
    }

    return this.addMessage(ticketId, userId, normalized, MessageType.USER);
  }
}
