import { PartialType } from '@nestjs/mapped-types';
import { CreateUserPhoneDto } from './create-user-phone.dto';

export class UpdateUserPhoneDto extends PartialType(CreateUserPhoneDto) {}
