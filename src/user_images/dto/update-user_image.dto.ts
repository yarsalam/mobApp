import { PartialType } from '@nestjs/mapped-types';
import { CreateUserImageDto } from './create-user_image.dto';

export class UpdateUserImageDto extends PartialType(CreateUserImageDto) {}
