export class MessageResponseDto {
  id: number;
  from_id: number;
  to_id: number;
  content: string;
  is_free: boolean;
  created_at: Date;
  read_at: Date | null;
  isBlocked: boolean;
  isSuspended: boolean;
  isResigned: boolean;
  isAdminBlocked: boolean;
}
