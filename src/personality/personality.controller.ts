import { Controller, Post, Body } from '@nestjs/common';
import { PersonalityService } from './personality.service';

@Controller('personality')
export class PersonalityController {
  constructor(private readonly personalityService: PersonalityService) {}

  @Post('sentiment')
  async sentiment(@Body() body: { messages: string[] }) {
    return this.personalityService.analyzeSentiment(body.messages);
  }

  @Post('emotion')
  async emotion(@Body() body: { messages: string[] }) {
    return this.personalityService.analyzeEmotion(body.messages);
  }
}
