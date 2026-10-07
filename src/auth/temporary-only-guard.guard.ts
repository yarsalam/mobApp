import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class TemporaryOnlyGuard extends AuthGuard('jwt') {
  handleRequest(err, user, info) {
    if (err || !user) throw err || new UnauthorizedException();
    if (!user.temporary) {
      throw new UnauthorizedException('این توکن موقت نیست');
    }
    return user;
  }
}
