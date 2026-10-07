import { EventType } from '../type/event-type.enum';

export class LogEventDto {
  userId: number;
  targetUserId?: number | null;
  type: EventType;
  sessionId?: string;
  metadata?: any;
  value?: number;
  currency?: string;
  duration?: number;
  platform?: string;
  country?: string;
}
