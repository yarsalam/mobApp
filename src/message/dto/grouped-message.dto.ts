export class GroupedMessageDto {
  userId: number;
  name: string;
  avatar?: string;
  lastMessageSnippet: string;
  isFree: boolean;
  unread: boolean;
  isSuspended: boolean;
  isResigned: boolean;
  isAdminBlocked: boolean;
  lastFreeMessageDate?: string;
  lastPaidMessageDate?: string;
  lastFreeMessageTime?: string;
  lastPaidMessageTime?: string;
  unreadFreeMessagesCount?: number;
  unreadPaidMessagesCount?: number;
  freeMessages?: any[];
  paidMessages?: any[];
}
