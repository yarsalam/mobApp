import { PartialType } from '@nestjs/swagger';
import { CreateAiFeedbackDto } from './create-ai-feedback.dto';

export class UpdateAiFeedbackDto extends PartialType(CreateAiFeedbackDto) {}
