import { Controller, Get, Param } from '@nestjs/common';
import { VectorSearchService } from '../suggestion/retrieval/vector-search.service';
import { SuggestionService } from '../suggestion/suggestion.service';
import { RelationStatusService } from '../relation-status/relation-status.service';
import { FeedAssemblerService } from 'src/feed/services/feed-assembler.service';
import * as fs from 'fs';
import * as path from 'path';

@Controller('debug')
export class DebugController {
  constructor(
    private readonly vectorSearch: VectorSearchService,
    private readonly suggestionService: SuggestionService,
    private readonly feedAssembler: FeedAssemblerService,
    private readonly relationStatus: RelationStatusService,
  ) {}

  /**
   * روایت دستی و دقیق مرحله‌به‌مرحله یک مسیر کاربری (مثل ثبت‌نام)
   * از روی خواندن واقعی سورس — نه regex خودکار.
   * فایل‌ها در tools/flows/<name>-flow.json نگه‌داری می‌شوند.
   */
  @Get('flow/:name')
  getFlow(@Param('name') name: string) {
    if (process.env.NODE_ENV === 'production') {
      return { error: 'این endpoint فقط در محیط dev فعال است' };
    }
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
    const flowPath = path.join(
      process.cwd(),
      'tools',
      'flows',
      `${safe}-flow.json`,
    );
    try {
      const raw = fs.readFileSync(flowPath, 'utf8');
      return JSON.parse(raw);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        error: `روایت '${safe}' پیدا نشد یا ساخته نشده`,
        detail: message,
        available: (() => {
          try {
            return fs
              .readdirSync(path.join(process.cwd(), 'tools', 'flows'))
              .filter((f) => f.endsWith('-flow.json'))
              .map((f) => f.replace('-flow.json', ''));
          } catch {
            return [];
          }
        })(),
      };
    }
  }

  @Get('dependency-graph')
  getDependencyGraph() {
    if (process.env.NODE_ENV === 'production') {
      return { error: 'این endpoint فقط در محیط dev فعال است' };
    }
    const graphPath = path.join(
      process.cwd(),
      'tools',
      'dependency-graph.json',
    );
    try {
      const raw = fs.readFileSync(graphPath, 'utf8');
      return JSON.parse(raw);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        error: 'گراف هنوز ساخته نشده — `npm run graph:scan` را اجرا کن',
        detail: message,
      };
    }
  }

  @Get('suggestions/:userId')
  async testSuggestions(@Param('userId') userId: number) {
    try {
      const candidates = await this.vectorSearch.findCandidates(userId, 200);
      const suggestions =
        await this.suggestionService.getSuggestionsForUser(userId);
      return {
        candidatesCount: candidates.length,
        suggestionsCount: suggestions.length,
        candidates,
        suggestions,
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      return { error: message, stack };
    }
  }

  @Get('feed/:userId')
  async testFeed(@Param('userId') userId: number) {
    try {
      const feed = await this.feedAssembler.buildFeed(userId, { limit: 5 });
      return { feedLength: feed.length, feed };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      return { error: message, stack };
    }
  }

  @Get('relation/:userId/:targetId')
  async testRelation(
    @Param('userId') userId: number,
    @Param('targetId') targetId: number,
  ) {
    try {
      const rel = await this.relationStatus.getEffectiveRelation(
        userId,
        targetId,
      );
      return rel;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      return { error: message, stack };
    }
  }
}
