export function getChatRoomName(userA: number, userB: number): string {
  const [min, max] = [Math.min(userA, userB), Math.max(userA, userB)];
  return `chat_${min}_${max}`;
}
