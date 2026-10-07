import { PartialType } from '@nestjs/swagger';
import { CreateDevicePhoneDto } from './create-device-phone.dto';

export class UpdateDevicePhoneDto extends PartialType(CreateDevicePhoneDto) {}
