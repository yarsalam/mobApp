import { Controller } from '@nestjs/common';
import { SocialListenerService } from './social-listener.service';

@Controller('social-listener')
export class SocialListenerController {
  constructor(private readonly socialListenerService: SocialListenerService) {}
}
