import { IsBoolean } from 'class-validator';

export class PersonalityTextConsentDto {
  @IsBoolean()
  enabled: boolean;
}
