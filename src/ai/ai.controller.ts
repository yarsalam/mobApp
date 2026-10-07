import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { PredictDto } from './dto/predict.dto';
import { EmbedDto } from './dto/embed.dto';
import { CompareDto } from './dto/compare.dto';
import { TrainDto } from './dto/train.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('recommend')
  async recommend(
    @Body() body: { userId: number; candidateIds: number[]; weights: any },
  ) {
    return this.aiService.recommend(
      body.userId,
      body.candidateIds,
      body.weights,
    );
  }

  @Post('embed')
  async embed(@Body() body: EmbedDto) {
    return this.aiService.embedText(body.text);
  }

  @Post('compare')
  async compare(@Body() body: CompareDto) {
    return this.aiService.compareTexts(body.text1, body.text2);
  }

  @Post('predict')
  async predict(@Body() body: PredictDto) {
    const { userA, userB } = body;
    return this.aiService.predict({ userA, userB });
  }

  @Post('train')
  async train(@Body() body: TrainDto) {
    return this.aiService.train(body.modelName, body.datasetPath);
  }
}
