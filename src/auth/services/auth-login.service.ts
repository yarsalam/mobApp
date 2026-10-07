import {
  Injectable,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { UserEventService } from '../../user-event/user-event.service';
import * as bcrypt from 'bcrypt';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class AuthLoginService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly userEventService: UserEventService,
  ) {}

  async login(phone: string, password: string) {
    const user = await this.usersService.findByPhone(phone);
    if (!user) {
      throw new HttpException(
        {
          message: 'کاربر با این شماره یافت نشد.لطفا ثبت نام کنید.',
          code: 'NOT_EXISTING_USER',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    if (!user.password) {
      throw new UnauthorizedException('برای این کاربر رمز ثبت نشده است');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) throw new UnauthorizedException('رمز عبور اشتباه است');

    const payload = { sub: user.id, phone: user.phone };
    const token = this.jwtService.sign(payload, { expiresIn: '30d' });

    await this.userEventService.log({
      userId: user.id,
      type: EventType.LOGIN,
      metadata: { via: 'password' },
    });

    await this.userEventService.log({
      userId: user.id,
      type: EventType.APP_OPEN,
      metadata: { via: 'login' },
    });

    return { token };
  }
}
