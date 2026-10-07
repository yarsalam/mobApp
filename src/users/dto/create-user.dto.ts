import { IsOptional } from "class-validator";

export class CreateUserDto {
  phone: string;
  gender: string;
  isCompleted?: boolean;
  metadata?: Record<string, any>;

  @IsOptional()
  acquisitionSource?: string; // optional

  @IsOptional()
  acquisitionKeyword?: string; // optional
}
