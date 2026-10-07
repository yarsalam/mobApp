import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@WebSocketGateway({ cors: true, namespace: '/notification' })
@Injectable()
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      if (!token) throw new Error('No token provided');

      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('JWT_SECRET not set');

      const payload = jwt.verify(token, secret) as { sub: string };
      const userId = parseInt(payload.sub, 10);

      if (isNaN(userId)) throw new Error('Invalid user ID in token');

      client.join(`user_${userId}`);
      client.data.userId = userId;
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

  send(userId: number, payload: any) {
    this.server.to(`user_${userId}`).emit('notification', payload);
  }
}
