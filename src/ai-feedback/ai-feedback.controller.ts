import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { AiFeedbackService } from './ai-feedback.service';
import { CreateAiFeedbackDto } from './dto/create-ai-feedback.dto';
import { ConversionAnalyticsService } from './services/conversion-analytics.service';

@Controller('feedback')
export class AiFeedbackController {
  constructor(
    private readonly service: AiFeedbackService,
    private readonly conversionAnalytics: ConversionAnalyticsService,
  ) {}

  @Post()
  async create(@Body() dto: CreateAiFeedbackDto) {
    return this.service.create(dto);
  }

  @Get()
  async getAll(@Query('limit') limit?: number) {
    return this.service.findAll(limit ? +limit : 100);
  }

  @Get('metrics')
  async metrics() {
    return this.service.getMetrics();
  }

  @Get('conversion-insights')
  async getConversionInsights(@Query('userId') userId?: number) {
    return this.conversionAnalytics.analyzeConversion(
      userId ? +userId : undefined,
    );
  }

  @Get('conversion-insights/top-features')
  async getTopPerformingFeatures() {
    const insights = await this.conversionAnalytics.analyzeConversion();
    return insights.topPerformingFeatures;
  }
}
