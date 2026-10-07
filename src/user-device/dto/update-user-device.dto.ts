import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDeviceDto } from './create-user-device.dto';

export class UpdateUserDeviceDto extends PartialType(CreateUserDeviceDto) {}
