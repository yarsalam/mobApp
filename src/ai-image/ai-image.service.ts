import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiImage } from './entities/ai-image.entity';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreateAiImageDto } from './dto/create-ai-image.dto';
import { UserEventService } from 'src/user-event/user-event.service';
import { EventType } from 'src/user-event/type/event-type.enum';


@Injectable()
export class AiImageService {
  private readonly logger = new Logger(AiImageService.name);

  constructor(
    @InjectRepository(AiImage)
    private repo: Repository<AiImage>,
    private readonly userEventService: UserEventService,
    @InjectQueue('ai-image') private queue: Queue,
  ) {}

  async upload(dto: CreateAiImageDto) {
    const saved = await this.repo.save(this.repo.create(dto));

    await Promise.all([
      this.queue.add('analyze_image', saved),
      this.userEventService.log({
        userId: dto.userId,
        type: EventType.AI_IMAGE_UPLOADED, // نام صحیح event
        metadata: {
          path: dto.path,
          filename: dto.filename,
        },
      }),
    ]);

    return saved;
  }

  async findByUser(userId: number) {
    return this.repo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }
}
