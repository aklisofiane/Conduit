import { Global, Module } from '@nestjs/common';
import { auth, auditLogService, abuseSignalsService } from './auth.config';
import { AuthController } from './auth.controller';
import { AbuseSignalsService } from './abuse-signals';
import { AuditLogService } from './audit-log.service';
import { SessionGuard } from './session.guard';
import { TokenRefreshService } from './token-refresh.service';
// Side-effect import: declares Express.Request augmentation for `user`/`session`.
import './types';

/**
 * Auth wiring. The Better Auth instance itself is exported as a `AUTH` token
 * for future sub-features that want to call its server API. The HTTP surface
 * (`/api/auth/*`) is mounted in `main.ts` as Express middleware *before*
 * `express.json()` — Nest controllers don't see those routes.
 *
 * `AuditLogService` + `AbuseSignalsService` resolve to the same module-level
 * instances used by Better Auth's hooks (registered here via `useValue`).
 * The production write path runs from Express middleware before any Nest
 * controller — DI isn't available at write time, so we share instances
 * rather than letting Nest construct a second copy.
 *
 * `TokenRefreshService` is the one piece of *scheduled* auth work: it keeps
 * linked OAuth access tokens (and the credentials mirrored from them) alive.
 */
export const AUTH = Symbol.for('conduit.auth');

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    SessionGuard,
    TokenRefreshService,
    { provide: AuditLogService, useValue: auditLogService },
    { provide: AbuseSignalsService, useValue: abuseSignalsService },
    { provide: AUTH, useValue: auth },
  ],
  exports: [SessionGuard, AuditLogService, AbuseSignalsService, AUTH],
})
export class AuthModule {}
