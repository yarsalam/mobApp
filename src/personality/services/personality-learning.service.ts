import { Injectable } from '@nestjs/common';
import { PersonalityWeightService } from './personality-weight.service';

@Injectable()
export class PersonalityLearningService {
  constructor(private readonly weightService: PersonalityWeightService) {}

  async learnFromMatch(
    ocean1: Record<string, number>,
    sentiment1: string,
    ocean2: Record<string, number>,
    sentiment2: string,
  ): Promise<void> {
    const features = [
      'openness',
      'conscientiousness',
      'extraversion',
      'agreeableness',
      'neuroticism',
    ];

    for (const f of features) {
      const v1 = ocean1[f];
      const v2 = ocean2[f];
      if (v1 === undefined || v2 === undefined) continue;
      const avg = (v1 + v2) / 2;
      const current = await this.weightService.getWeight(f);
      const reward = avg > 0.6 ? 0.01 : -0.005;
      const newVal = Math.max(0.1, Math.min(3.0, current + reward));
      await this.weightService.setWeight(f, newVal);
    }

    if (sentiment1 === 'positive' && sentiment2 === 'positive') {
      const cur = await this.weightService.getWeight('sentiment_positive');
      await this.weightService.setWeight(
        'sentiment_positive',
        Math.min(3.0, cur + 0.01),
      );
    }
  }
}
