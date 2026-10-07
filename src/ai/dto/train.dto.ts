import { IsString } from 'class-validator';

export class TrainDto {
  @IsString()
  modelName: string;

  @IsString()
  datasetPath: string;
}
