import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AEOTrackerService {
  private readonly logger = new Logger(AEOTrackerService.name);
  constructor(private readonly httpService: HttpService) {}

  async getMentions(brand: string, prompts: string[]) {
    const url = `${process.env.AEO_TRACKER_URL}/check-mentions`;
    const { data } = await firstValueFrom(
      this.httpService.post(url, { brand, prompts }),
    );
    return data;
  }
}
