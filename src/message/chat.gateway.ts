import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({ cors: true })
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token =
      client.handshake.auth?.token ||
      client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify(token);

      const userId = Number(payload.sub);

      if (!Number.isSafeInteger(userId) || userId <= 0) {
        client.disconnect(true);
        return;
      }

      client.data.userId = userId;

      // هر کاربر همیشه عضو اتاق خصوصی خودش است.
      await client.join(this.getUserRoom(userId));
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(
      `Chat socket disconnected; userId=${client.data.userId ?? 'unknown'}`,
    );
  }

  @SubscribeMessage('join')
  async handleJoin(
    @MessageBody() data: { room?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ success: boolean; message?: string }> {
    const userId = client.data.userId;

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      client.disconnect(true);
      return { success: false, message: 'احراز هویت نامعتبر است.' };
    }

    if (typeof data?.room !== 'string') {
      return { success: false, message: 'نام اتاق نامعتبر است.' };
    }

    const match = /^chat_(\d+)_(\d+)$/.exec(data.room);

    if (!match) {
      return { success: false, message: 'نام اتاق نامعتبر است.' };
    }

    const firstId = Number(match[1]);
    const secondId = Number(match[2]);

    if (
      !Number.isSafeInteger(firstId) ||
      !Number.isSafeInteger(secondId) ||
      firstId <= 0 ||
      secondId <= 0 ||
      firstId >= secondId ||
      (userId !== firstId && userId !== secondId)
    ) {
      return {
        success: false,
        message: 'شما اجازه ورود به این گفت‌وگو را ندارید.',
      };
    }

    await client.join(data.room);
    return { success: true };
  }

  @SubscribeMessage('leave')
  async handleLeave(
    @MessageBody() data: { room?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ success: boolean }> {
    if (typeof data?.room !== 'string') {
      return { success: false };
    }

    const match = /^chat_(\d+)_(\d+)$/.exec(data.room);
    const userId = client.data.userId;

    if (!match) {
      return { success: false };
    }

    const firstId = Number(match[1]);
    const secondId = Number(match[2]);

    if (userId !== firstId && userId !== secondId) {
      return { success: false };
    }

    await client.leave(data.room);
    return { success: true };
  }

  static getRoomName(a: number, b: number): string {
    return `chat_${Math.min(a, b)}_${Math.max(a, b)}`;
  }

  private getUserRoom(userId: number): string {
    return `user_${userId}`;
  }

  async emitNewMessage(room: string, message: unknown): Promise<void> {
    this.server.to(room).emit('new_message', message);
  }

  async emitMessageRead(room: string, messageId: number): Promise<void> {
    this.server.to(room).emit('message_read', { messageId });
  }

  @OnEvent('message.created')
  async handleMessageCreated(payload: {
    room: string;
    message: unknown;
  }): Promise<void> {
    this.server.to(payload.room).emit('new_message', payload.message);
  }
}
