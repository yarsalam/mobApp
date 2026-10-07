import { Controller, Post } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Controller('queues')
export class QueuesController {
  constructor(
    @InjectQueue('ml-training')
    private readonly mlTrainingQueue: Queue,
  ) {}

  @Post('train')
  async triggerTraining() {
    await this.mlTrainingQueue.add('train-xgboost', {});
    return { status: 'queued' };
  }
}
