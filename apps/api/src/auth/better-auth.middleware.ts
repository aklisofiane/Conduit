import type { Request, Response, NextFunction } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth.config';

const handler = toNodeHandler(auth);

/**
 * Express middleware that hands `/api/auth/*` requests off to Better Auth's
 * Node handler. Mounted in `main.ts` BEFORE `express.json()` so Better Auth
 * sees the raw request stream.
 */
export function betterAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  handler(req, res).catch(next);
}
