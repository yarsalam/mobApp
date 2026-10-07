import { PartialType } from '@nestjs/swagger';
import { CreateAiImageDto } from './create-ai-image.dto';

export class UpdateAiImageDto extends PartialType(CreateAiImageDto) {}
