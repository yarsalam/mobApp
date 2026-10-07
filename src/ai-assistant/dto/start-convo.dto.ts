import { IsNotEmpty, IsString } from 'class-validator';

export class StartConvoDto {
  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsString()
  initialMessage?: string;
}
