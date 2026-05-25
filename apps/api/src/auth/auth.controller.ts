import { Controller, Get } from '@nestjs/common';
import { config } from '../config';
import { oauthProviders } from './auth.config';

/**
 * Public auth metadata. Single source of truth for the web UI to decide
 * which buttons to render (email/password is always on; OAuth providers
 * surface only when their env vars are set). NOT guarded by SessionGuard
 * — by definition consumers haven't logged in yet.
 */
@Controller('auth-config')
export class AuthController {
  @Get()
  get(): {
    deployment: 'local' | 'hosted';
    oauthProviders: readonly string[];
    registrationMode: 'open' | 'invite-only';
  } {
    return {
      deployment: config.deployment,
      oauthProviders,
      registrationMode: config.deployment === 'hosted' ? 'invite-only' : 'open',
    };
  }
}
