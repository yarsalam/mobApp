import { PartialType } from '@nestjs/swagger';
import { CreatePersonalityDto } from './create-personality.dto';

export class UpdatePersonalityDto extends PartialType(CreatePersonalityDto) {}
