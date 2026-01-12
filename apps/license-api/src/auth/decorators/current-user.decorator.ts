import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminUserEntity } from '../entities/admin-user.entity';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AdminUserEntity => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
