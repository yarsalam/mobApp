import { IsString } from 'class-validator';

export class EmbedDto {
  @IsString()
  text: string;
}
