import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return null;

    // اگر کل یوزر خواسته شده
    if (!data) {
      return user.id ? user : { ...user, id: user.sub };
    }

    // اگر مثلاً GetUser('id')
    if (data === 'id') {
      return user.id ?? user.sub;
    }

    // بقیه فیلدها
    return user[data];
  },
);
