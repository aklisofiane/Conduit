import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { auth } from './auth.config';

/**
 * Resolves a Better Auth session from the incoming request cookies/headers;
 * on miss throws 401. On hit attaches `req.user` and `req.session` so
 * downstream code can read them. Applied via `@UseGuards(SessionGuard)` on
 * every non-webhook controller.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const result = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!result) {
      throw new UnauthorizedException('Authentication required');
    }
    req.user = result.user;
    req.session = result.session;
    return true;
  }
}
