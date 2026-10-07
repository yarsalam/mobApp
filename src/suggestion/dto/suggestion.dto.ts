import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SuggestionDto {
  @ApiProperty() id: number;
  @ApiProperty() nickname: string;
  @ApiProperty() age: number;

  @ApiPropertyOptional() city?: string;
  @ApiPropertyOptional() province?: string;
  @ApiPropertyOptional() avatar?: string;
  @ApiPropertyOptional() aboutme?: string;
  @ApiPropertyOptional() partner_about?: string;
  @ApiPropertyOptional({ type: [String] }) hobbies?: string[];
  @ApiPropertyOptional({ type: [String] }) values?: string[];
  @ApiPropertyOptional() compatibilityScore?: number;
  @ApiPropertyOptional() isOnline?: boolean;
}
