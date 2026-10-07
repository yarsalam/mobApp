import { User } from 'src/users/entities/user.entity';
import { ClientInfo } from './client-info.type';

export interface RequestWithUser extends Request {
  user: User;
}

declare global {
  namespace Express {
    interface Request {
      clientInfo: ClientInfo;
    }
  }
}
export {};
