import { Controller } from '@nestjs/common';
import { AiOpsService } from './ai-ops.service';

@Controller('ai-ops')
export class AiOpsController {
  constructor(private readonly aiOpsService: AiOpsService) {}
}
