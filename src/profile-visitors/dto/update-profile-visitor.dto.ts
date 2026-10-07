import { PartialType } from '@nestjs/mapped-types';
import { CreateProfileVisitorDto } from './create-profile-visitor.dto';

export class UpdateProfileVisitorDto extends PartialType(
  CreateProfileVisitorDto,
) {}
