import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  SupportTicket,
  TicketCategory,
  TicketPriority,
} from '../entities/ticket.entity';
import { TicketMessage, MessageType } from '../entities/ticket-message.entity';
import { TicketEvent, TicketEventType } from '../entities/ticket-event.entity';

@Processor('ai-support')
@Injectable()
export class AiSupportProcessor extends WorkerHost {
  private readonly logger = new Logger(AiSupportProcessor.name);
  private readonly aiUrl =
    process.env.AI_SUPPORT_URL || 'http://ai_support:8016';

  constructor(
    @InjectRepository(SupportTicket)
    private ticketRepo: Repository<SupportTicket>,
    @InjectRepository(TicketMessage)
    private messageRepo: Repository<TicketMessage>,
    @InjectRepository(TicketEvent)
    private eventRepo: Repository<TicketEvent>,
    private http: HttpService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'analyze-ticket') return this.analyzeTicket(job);
    if (job.name === 'ticket-feedback') return this.processFeedback(job);
    this.logger.warn(`Unknown job: ${job.name}`);
  }

  // ── analyze ────────────────────────────────────────────────────────────────

  private async analyzeTicket(job: Job) {
    const { ticketId, content, userId, isUpdate } = job.data;
    this.logger.log(`[Queue] analyze-ticket #${ticketId}`);

    try {
      const { data } = await firstValueFrom(
        this.http.post(`${this.aiUrl}/api/analyze`, {
          ticketId,
          content,
          userId,
          userTier: job.data.userTier ?? 'free',
          totalPurchases: job.data.totalPurchases ?? 0,
        }),
      );
      await this.applyAnalysis(ticketId, data.analysis, isUpdate);
    } catch (err) {
      this.logger.error(`analyze-ticket #${ticketId} failed: ${err}`);
    }
  }

  private async applyAnalysis(
    ticketId: number,
    analysis: Record<string, any>,
    isUpdate: boolean,
  ) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) return;

    const catMap: Record<string, TicketCategory> = {
      technical: TicketCategory.TECHNICAL,
      billing: TicketCategory.BILLING,
      account: TicketCategory.ACCOUNT,
      feature_request: TicketCategory.FEATURE_REQUEST,
      report: TicketCategory.REPORT,
    };
    const priMap: Record<string, TicketPriority> = {
      urgent: TicketPriority.URGENT,
      high: TicketPriority.HIGH,
      medium: TicketPriority.MEDIUM,
      low: TicketPriority.LOW,
    };

    // Update ticket fields
    ticket.category = catMap[analysis.suggested_category] ?? ticket.category;
    ticket.priority = priMap[analysis.suggested_priority] ?? ticket.priority;
    ticket.aiConfidenceScore = analysis.confidence_score;
    ticket.keywords = analysis.keywords ?? [];
    ticket.aiSuggestions = {
      suggestedCategory: analysis.suggested_category,
      suggestedPriority: analysis.suggested_priority,
      similarTickets: analysis.similar_tickets ?? [],
      estimatedResolutionTime: analysis.estimated_resolution_hours,
      autoResponse: analysis.auto_response,
    };
    ticket.sentimentAnalysis = {
      score: analysis.sentiment?.score ?? 0,
      label: analysis.sentiment?.label ?? 'neutral',
      emotions: analysis.sentiment?.emotions ?? [],
      urgencyScore: analysis.urgency_score ?? 0,
    };

    // SLA deadline (only set once)
    if (!ticket.slaDeadline && analysis.estimated_resolution_hours) {
      const d = new Date();
      d.setHours(d.getHours() + analysis.estimated_resolution_hours);
      ticket.slaDeadline = d;
    }

    await this.ticketRepo.save(ticket);

    // Post auto-response on first creation
    if (!isUpdate && analysis.auto_response) {
      const msg = this.messageRepo.create({
        ticket,
        type: MessageType.AI,
        content: analysis.auto_response,
        isAIGenerated: true,
        aiConfidence: analysis.confidence_score,
      });
      await this.messageRepo.save(msg);

      // Record first response time
      if (!ticket.firstResponseAt) {
        await this.ticketRepo.update(ticketId, { firstResponseAt: new Date() });
      }
    }

    await this.logEvent(ticketId, TicketEventType.AI_ANALYZED, {
      category: analysis.suggested_category,
      priority: analysis.suggested_priority,
      urgencyScore: analysis.urgency_score,
    });
  }

  // ── feedback ───────────────────────────────────────────────────────────────

  private async processFeedback(job: Job) {
    const { ticketId } = job.data;
    try {
      await firstValueFrom(
        this.http.post(`${this.aiUrl}/api/feedback`, job.data),
      );
      await this.logEvent(ticketId, TicketEventType.FEEDBACK_RECEIVED, {
        rating: job.data.rating,
      });
    } catch (err) {
      this.logger.error(`ticket-feedback #${ticketId} failed: ${err}`);
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async logEvent(
    ticketId: number,
    type: TicketEventType,
    meta?: Record<string, any>,
    actorId?: number,
  ) {
    try {
      await this.eventRepo.save(
        this.eventRepo.create({ ticketId, type, meta, actorId }),
      );
    } catch {}
  }
}
