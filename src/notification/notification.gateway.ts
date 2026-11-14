import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as jwt from 'jsonwebtoken';
import { User } from 'src/users/entities/user.entity';

@WebSocketGateway({ cors: true, namespace: '/notification' })
@Injectable()
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string;
      if (!token) throw new Error('No token provided');

      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('JWT_SECRET not set');

      const payload = jwt.verify(token, secret) as { sub: string };
      const userId = Number(payload.sub);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new Error('Invalid user ID in token');
      }

      await client.join(`user_${userId}`);
      client.data.userId = userId;

      // The authenticated socket marks the user's return to the app.
      await this.userRepo.update(userId, { lastActive: new Date() });
      this.logger.log(`User ${userId} connected to notifications`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Connection failed: ' + message);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(
      `User ${client.data?.userId} disconnected from notifications`,
    );
  }

  isOnline(userId: number): boolean {
    const room = this.server?.sockets?.adapter?.rooms?.get(`user_${userId}`);
    return Boolean(room && room.size > 0);
  }

  send(userId: number, payload: any) {
    this.server?.to(`user_${userId}`).emit('notification', payload);
  }
}
