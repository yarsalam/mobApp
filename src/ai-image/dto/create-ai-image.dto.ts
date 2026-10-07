import { IsInt, IsString, IsOptional } from 'class-validator';

export class CreateAiImageDto {
  @IsInt()
  userId: number;

  @IsString()
  path: string;

  @IsString()
  filename: string;

  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  size?: string;
}
