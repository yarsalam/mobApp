import { PartialType } from '@nestjs/swagger';
import { CreateSeoDto } from './create-seo.dto';

export class UpdateSeoDto extends PartialType(CreateSeoDto) {}
