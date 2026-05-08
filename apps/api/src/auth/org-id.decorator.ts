import {
  ForbiddenException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Resolves the active organization from the session attached by
 * `SessionGuard`. Every tenant-scoped controller method takes
 * `@OrgId() orgId: string` and forwards it to the service layer, which
 * applies it to every `where` / `data` clause.
 *
 * Throws `ForbiddenException` if the session has no active organization —
 * this should not happen in practice because the signup shim creates a
 * personal org and sets `activeOrganizationId` for every new user, but the
 * thrown error fails closed if a session predates the shim.
 */
export const OrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const orgId = req.session?.activeOrganizationId;
    if (!orgId) {
      throw new ForbiddenException('No active organization on session');
    }
    return orgId;
  },
);
