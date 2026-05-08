import { Global, Module } from '@nestjs/common';
import { auth } from './auth.config';
import { AuthController } from './auth.controller';
import { AbuseSignalsService } from './abuse-signals';
import { AuditLogService } from './audit-log.service';
import { SessionGuard } from './session.guard';
// Side-effect import: declares Express.Request augmentation for `user`/`session`.
import './types';

/**
 * Auth wiring. The Better Auth instance itself is exported as a `AUTH` token
 * for future sub-features that want to call its server API (e.g. data-model-
 * partitioning's signup hook reaches it through here). The HTTP surface
 * (`/api/auth/*`) is mounted in `main.ts` as Express middleware *before*
 * `express.json()` — Nest controllers don't see those routes.
 *
 * `AuditLogService` + `AbuseSignalsService` are registered as providers
 * primarily for unit / contract tests. The production audit-log writes
 * happen from Better Auth hooks wired in `auth.config.ts` against the
 * singleton `prisma` client — those run from Express middleware before any
 * Nest controller, so they can't go through DI.
 */
export const AUTH = Symbol.for('conduit.auth');

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    SessionGuard,
    AuditLogService,
    AbuseSignalsService,
    { provide: AUTH, useValue: auth },
  ],
  exports: [SessionGuard, AuditLogService, AbuseSignalsService, AUTH],
})
export class AuthModule {}
