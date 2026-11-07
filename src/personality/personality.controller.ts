import { Controller, Post, Body, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { GetUser } from 'src/auth/decorator/get-user/get-user.decorator';
import { PersonalityTextConsentDto } from './dto/personality-text-consent.dto';
import { PersonalityService } from './personality.service';

@Controller('personality')
export class PersonalityController {
  constructor(private readonly personalityService: PersonalityService) {}

  @Get('text-analysis-consent')
  @UseGuards(JwtAuthGuard)
  getTextAnalysisConsent(@GetUser('id') userId: number) {
    return this.personalityService.getTextAnalysisConsent(userId);
  }

  @Patch('text-analysis-consent')
  @UseGuards(JwtAuthGuard)
  setTextAnalysisConsent(
    @GetUser('id') userId: number,
    @Body() body: PersonalityTextConsentDto,
  ) {
    return this.personalityService.setTextAnalysisConsent(userId, body.enabled);
  }

  @Post('ocean/text-estimate')
  @UseGuards(JwtAuthGuard)
  analyzeTextPersonality(@GetUser('id') userId: number) {
    return this.personalityService.analyzeTextPersonality(userId);
  }

  @Post('sentiment')
  async sentiment(@Body() body: { messages: string[] }) {
    return this.personalityService.analyzeSentiment(body.messages);
  }

  @Post('emotion')
  async emotion(@Body() body: { messages: string[] }) {
    return this.personalityService.analyzeEmotion(body.messages);
  }
}
