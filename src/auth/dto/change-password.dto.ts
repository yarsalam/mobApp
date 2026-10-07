import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(3, { message: 'رمز عبور باید حداقل 3 کاراکتر باشد' })
  password: string;
}
