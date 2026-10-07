import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { FeedAssemblerService } from 'src/feed/services/feed-assembler.service';

@Controller('admin-api/product/feed-simulator')
@UseGuards(AdminApiGuard)
export class FeedSimulatorController {
  private aiImageUrl: string;
  constructor(
    private readonly feedAssembler: FeedAssemblerService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.aiImageUrl = this.config.get('AI_IMAGE_URL') || 'http://ai_image:8102';
  }

  @Get()
  async simulateFeed(
    @Query('userId') userId: number,
    @Query('limit') limit?: number,
    @Query('city') city?: string,
  ) {
    try {
      return await this.feedAssembler.buildFeed(userId, { limit, city });
    } catch {
      return [];
    }
  }

  @Post('analyze-image')
  async analyzeImage(@Body('url') url: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(`${this.aiImageUrl}/image/analyze`, { url }),
      );
      return data;
    } catch {
      return null;
    }
  }
}
