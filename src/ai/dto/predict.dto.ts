import { IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class PredictDto {
  @IsString()
  modelName: string;

  @IsObject()
  input: Record<string, any>;

  @IsOptional()
  @IsString()
  version?: string;

  @IsNumber()
  userA: number;

  @IsNumber()
  userB: number;
}
