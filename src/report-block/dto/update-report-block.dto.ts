import { PartialType } from '@nestjs/swagger';
import { CreateReportBlockDto } from './create-report-block.dto';

export class UpdateReportBlockDto extends PartialType(CreateReportBlockDto) {}
