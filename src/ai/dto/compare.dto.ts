import { IsString } from 'class-validator';

export class CompareDto {
  @IsString()
  text1: string;

  @IsString()
  text2: string;
}
