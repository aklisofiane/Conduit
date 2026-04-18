import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { config } from '../config';

/**
 * Minimal API-key guard: single shared secret in env, checked on every
 * non-webhook route. See docs/SECURITY.md — "API auth (v1)". Webhooks use
 * HMAC and skip this guard.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!config.apiKey) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.header('x-api-key');
    if (key !== config.apiKey) {
      throw new UnauthorizedException('Invalid or missing X-API-Key header');
    }
    return true;
  }
}
