import { createAuthMiddleware, getIp, isAPIError } from 'better-auth/api';
import type { BetterAuthOptions } from 'better-auth';
import type { OrganizationOptions } from 'better-auth/plugins';
import type { AbuseSignalsService } from './abuse-signals';
import type { AuditLogService } from './audit-log.service';

type OrganizationHooks = NonNullable<OrganizationOptions['organizationHooks']>;

interface AuditHookDeps {
  auditLog: AuditLogService;
  abuseSignals: AbuseSignalsService;
}

/**
 * Read the actor IP off the live request via Better Auth's `getIp`. Falls
 * back to `ctx.headers` when there's no underlying `Request` (e.g. internal
 * `auth.api.*` calls that pass headers but no Request object). The helper
 * applies the same `ipAddress.ipAddressHeaders` overrides Better Auth uses
 * internally for rate-limit storage, so what we record matches what gets
 * rate-limited.
 */
function actorIpOf(ctx: AuditHookCtx): string | null {
  const opts = ctx.context.options as BetterAuthOptions;
  if (ctx.request) {
    return getIp(ctx.request, opts) ?? null;
  }
  if (ctx.headers) {
    return getIp(ctx.headers, opts) ?? null;
  }
  return null;
}

// Loose shape for the after-middleware ctx — Better Auth's middleware ctx
// type is too deep for productive surface area in typed handler code, and
// we only need a handful of fields. Narrow shapes are checked at access.
interface AuditHookCtx {
  path: string;
  request?: Request;
  headers?: Headers;
  body?: Record<string, unknown>;
  context: {
    options: BetterAuthOptions;
    returned?: unknown;
    newSession?: { user: { id: string; email: string } } | null;
    session?: { user: { id: string; email: string } } | null;
  };
}

function emailFromBody(ctx: AuditHookCtx): string | null {
  const body = ctx.body;
  if (!body) return null;
  const email = body.email;
  return typeof email === 'string' ? email : null;
}

function isUnauthorizedShape(returned: unknown): boolean {
  if (!isAPIError(returned)) return false;
  // Better Auth throws `APIError("UNAUTHORIZED", BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD)`
  // for every credential-mismatch shape on `/sign-in/email`. statusCode 401
  // is the principle ("known-shape failure"); we narrow to UNAUTHORIZED so a
  // 403 EMAIL_NOT_VERIFIED doesn't get logged as a credential failure.
  // The public APIError type doesn't surface `statusCode` directly; the
  // runtime instance does (better-call assigns it in the constructor).
  const err = returned as APIErrorLike;
  return err.statusCode === 401 || err.status === 'UNAUTHORIZED';
}

interface APIErrorLike {
  statusCode?: number;
  status?: string | number;
}

function returnedSucceeded(returned: unknown): boolean {
  if (returned == null) return false;
  if (isAPIError(returned)) return false;
  return true;
}

// Wraps an async handler so a write failure cannot break the auth or org
// mutation it trails. Failures are observable via Nest's default error
// logging — we never let audit failures cascade into the response.
function safe<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args) => {
    try {
      await fn(...args);
    } catch {
      // swallow
    }
  };
}

/**
 * Single `hooks.after` middleware. Path-dispatches to per-event handlers.
 * Each handler is `async () => void` — never throws into Better Auth's
 * pipeline; audit-log writes that fail are swallowed and logged at the
 * service so a transient DB hiccup can't break sign-in.
 *
 * Org-mutation events (create/delete/update, member add/remove/role-change,
 * invitation lifecycle) are wired separately via the `organization` plugin's
 * `organizationHooks` — they expose richer typed payloads (`previousRole`,
 * `member`, `organization`) than path-pattern dispatch can extract.
 */
export function createAuditAfterMiddleware(
  deps: AuditHookDeps,
): ReturnType<typeof createAuthMiddleware> {
  const dispatchSafe = safe(dispatch);
  return createAuthMiddleware(async (rawCtx) => {
    await dispatchSafe(rawCtx as unknown as AuditHookCtx, deps);
  });
}

async function dispatch(ctx: AuditHookCtx, deps: AuditHookDeps): Promise<void> {
  const path = ctx.path;
  const ip = actorIpOf(ctx);
  const returned = ctx.context.returned;

  if (path === '/sign-in/email') {
    if (returnedSucceeded(returned) && ctx.context.newSession) {
      const u = ctx.context.newSession.user;
      await deps.auditLog.record({
        event: 'auth.signIn',
        actorUserId: u.id,
        actorEmail: u.email,
        actorIp: ip,
        metadata: { provider: 'email' },
      });
      return;
    }
    if (isUnauthorizedShape(returned)) {
      const email = emailFromBody(ctx);
      if (email) {
        await deps.auditLog.record({
          event: 'auth.signIn.failed',
          actorEmail: email,
          actorIp: ip,
          metadata: { provider: 'email' },
        });
        await deps.abuseSignals.checkFailedLoginSpike({ actorEmail: email });
      }
    }
    return;
  }

  // Social sign-in success (callback path) — `ctx.context.newSession` is set.
  if (path.startsWith('/callback/') && ctx.context.newSession) {
    if (!returnedSucceeded(returned)) return;
    const u = ctx.context.newSession.user;
    const provider = path.slice('/callback/'.length) || 'oauth';
    await deps.auditLog.record({
      event: 'auth.signIn',
      actorUserId: u.id,
      actorEmail: u.email,
      actorIp: ip,
      metadata: { provider },
    });
    return;
  }

  if (path === '/sign-up/email' && returnedSucceeded(returned) && ctx.context.newSession) {
    const u = ctx.context.newSession.user;
    await deps.auditLog.record({
      event: 'auth.signUp',
      actorUserId: u.id,
      actorEmail: u.email,
      actorIp: ip,
      metadata: { provider: 'email' },
    });
    return;
  }

  if (path === '/sign-out' && returnedSucceeded(returned)) {
    const u = ctx.context.session?.user;
    await deps.auditLog.record({
      event: 'auth.signOut',
      actorUserId: u?.id,
      actorEmail: u?.email,
      actorIp: ip,
    });
    return;
  }

  if (path === '/request-password-reset' && returnedSucceeded(returned)) {
    const email = emailFromBody(ctx);
    if (email) {
      await deps.auditLog.record({
        event: 'auth.passwordReset.requested',
        actorEmail: email,
        actorIp: ip,
      });
    }
    return;
  }

  if (path === '/reset-password' && returnedSucceeded(returned)) {
    await deps.auditLog.record({
      event: 'auth.passwordReset.completed',
      actorIp: ip,
    });
    return;
  }
}

/**
 * `organizationHooks` for the `organization()` plugin. Each `after*` hook
 * fires only when the underlying mutation succeeded (the plugin gates them
 * post-write), so the spec's "audit row written only after the underlying
 * operation succeeded" principle holds. Compared to the path-based middleware
 * dispatch, the plugin hooks expose typed `member`/`previousRole`/`organization`
 * payloads that would otherwise require a roundtrip to extract.
 */
export function createOrganizationAuditHooks(deps: AuditHookDeps): OrganizationHooks {
  return {
    afterCreateOrganization: safe(async ({ organization, user }) => {
      await deps.auditLog.record({
        event: 'org.created',
        actorUserId: user.id,
        actorEmail: user.email,
        orgId: organization.id,
        metadata: { name: organization.name },
      });
    }),
    afterDeleteOrganization: safe(async ({ organization, user }) => {
      await deps.auditLog.record({
        event: 'org.deleted',
        actorUserId: user.id,
        actorEmail: user.email,
        orgId: organization.id,
        metadata: { name: organization.name },
      });
    }),
    afterUpdateOrganization: safe(async ({ organization, user }) => {
      // v1 only flags name changes as `org.renamed`. Other fields (slug,
      // logo, metadata) are implicit no-ops at this layer; if they need
      // their own events later, they each get a new entry in the taxonomy.
      if (!organization) return;
      await deps.auditLog.record({
        event: 'org.renamed',
        actorUserId: user.id,
        actorEmail: user.email,
        orgId: organization.id,
        metadata: { to: organization.name },
      });
    }),
    afterCreateInvitation: safe(async ({ invitation, inviter, organization }) => {
      await deps.auditLog.record({
        event: 'org.member.invited',
        actorUserId: inviter.id,
        actorEmail: inviter.email,
        orgId: organization.id,
        metadata: {
          invitationId: invitation.id,
          inviteeEmail: invitation.email,
          role: invitation.role,
        },
      });
    }),
    afterAcceptInvitation: safe(async ({ invitation, user, organization }) => {
      await deps.auditLog.record({
        event: 'org.member.invitationAccepted',
        actorUserId: user.id,
        actorEmail: user.email,
        orgId: organization.id,
        metadata: { invitationId: invitation.id, inviteeEmail: invitation.email },
      });
    }),
    afterRejectInvitation: safe(async ({ invitation, user, organization }) => {
      await deps.auditLog.record({
        event: 'org.member.invitationRejected',
        actorUserId: user.id,
        actorEmail: user.email,
        orgId: organization.id,
        metadata: { invitationId: invitation.id, inviteeEmail: invitation.email },
      });
    }),
    afterCancelInvitation: safe(async ({ invitation, cancelledBy, organization }) => {
      await deps.auditLog.record({
        event: 'org.member.invitationRevoked',
        actorUserId: cancelledBy.id,
        actorEmail: cancelledBy.email,
        orgId: organization.id,
        metadata: { invitationId: invitation.id, inviteeEmail: invitation.email },
      });
    }),
    afterRemoveMember: safe(async ({ member, user, organization }) => {
      // self-leave vs. admin-remove: the leave route fires this hook with
      // actor === target. We split into two events so an operator can read
      // "who initiated this" without a JOIN.
      const isSelf = member.userId === user.id;
      await deps.auditLog.record({
        event: isSelf ? 'org.member.left' : 'org.member.removed',
        actorUserId: user.id,
        actorEmail: user.email,
        orgId: organization.id,
        targetUserId: isSelf ? null : member.userId,
        metadata: { role: member.role },
      });
    }),
    afterUpdateMemberRole: safe(async ({ member, previousRole, user, organization }) => {
      await deps.auditLog.record({
        event: 'org.member.roleChanged',
        actorUserId: user.id,
        actorEmail: user.email,
        orgId: organization.id,
        targetUserId: member.userId,
        metadata: { from: previousRole, to: member.role },
      });
    }),
  };
}
