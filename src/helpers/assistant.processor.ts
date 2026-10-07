import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { AssistantMessage } from 'src/ai-assistant/entities/assistant-message.entity';

@Processor('assistant')
export class AssistantProcessor extends WorkerHost {
  constructor(
    private readonly http: HttpService,
    @InjectRepository(AssistantMessage)
    private msgRepo: Repository<AssistantMessage>,
  ) {
    super();
  }

  // این متد به طور خودکار هر Job را از صف 'assistant' پردازش می‌کند
  async process(job: Job<any, any, string>): Promise<any> {
    const { convId, message, userId } = job.data;

    // فراخوانی سرویس Python AI
    const res = await firstValueFrom(
      this.http.post(`${process.env.PYTHON_AI_URL}/api/assistant/chat`, {
        user_id: userId,
        convId,
        message,
      }),
    );

    const answer = res.data.answer;

    // ذخیره پیام پاسخ در دیتابیس
    await this.msgRepo.save({
      conversation: { id: convId } as any,
      sender: 'assistant',
      content: answer,
    });

    return { status: 'done', answer };
  }
}
