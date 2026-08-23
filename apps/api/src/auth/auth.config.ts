import { betterAuth, APIError } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { Redis } from 'ioredis';
import { Logger } from '@nestjs/common';
import { prisma } from '@conduit/database';
import { config } from '../config';
import type { PrismaService } from '../common/prisma.service';
import { CredentialsService } from '../modules/credentials/credentials.service';
import { createBetterAuthRedisStorage } from '../redis/redis.service';
import { AbuseSignalsService } from './abuse-signals';
import { AuditLogService } from './audit-log.service';
import { createAuditAfterMiddleware, createOrganizationAuditHooks } from './audit-hooks';
import { createOAuthMirrorHooks } from './oauth-mirror-hooks';
import { createOrganizationGuardHooks } from './org-guard-hooks';
import { rateLimitConfig } from './rate-limit-config';

const githubOAuth = config.betterAuth.githubOAuth;
const gitlabOAuth = config.betterAuth.gitlabOAuth;

export const oauthProviders: readonly string[] = [
  ...(githubOAuth ? ['github'] : []),
  ...(gitlabOAuth ? ['gitlab'] : []),
];

/**
 * Derive a deterministic personal-org name + slug from the user's email.
 * Slug is `<localpart>-ws` plus a short random suffix to avoid the unique-
 * constraint collision when two users share the same localpart on
 * different domains (rare but possible). Polished naming + rename UI are
 * `org-on-signup-and-switching`'s job; this is the minimal shim.
 */
function personalOrgFor(email: string): { name: string; slug: string } {
  const localpart = email.split('@')[0] ?? 'user';
  // Cap matches the web's `slugify` (48) minus the 7-char `-${suffix}` we
  // append below, leaving headroom under any practical org-slug constraint
  // for long email localparts.
  const cleanLocal =
    (localpart.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'user').slice(0, 41);
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    name: `${localpart}'s workspace`,
    slug: `${cleanLocal}-${suffix}`,
  };
}

/**
 * Idempotent: returns the user's first existing org id, or creates a fresh
 * personal org and returns its id. Called from `session.create.before` so
 * brand-new users get an active org stamped on their very first session.
 *
 * Re-entrant on subsequent sessions for the same user (login again on a
 * second device) — the early-return on existing membership keeps the
 * shim from creating duplicate personal orgs.
 *
 * The user's email is fetched in the same query as the membership check
 * (one round-trip instead of two on the first-session path).
 */
async function ensurePersonalOrgFor(userId: string): Promise<string> {
  const userRow = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      email: true,
      members: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { organizationId: true },
      },
    },
  });
  const existing = userRow.members[0];
  if (existing) return existing.organizationId;
  const { name, slug } = personalOrgFor(userRow.email);
  // `auth.api.createOrganization` accepts a `userId` for system invocations
  // (no session yet), creates the org, and adds the user as `creatorRole`
  // (default "owner") in one server call.
  const org = await auth.api.createOrganization({
    body: {
      name,
      slug,
      userId,
      keepCurrentActiveOrganization: false,
    },
  });
  if (!org) {
    throw new Error(`Failed to create personal org for user ${userId}`);
  }
  return org.id;
}

/**
 * Hosted deployments are invitation-only: a signup is allowed if the address
 * is a configured seed email (or matches a seed domain) or has a live pending
 * invitation. Local deployments are open. Throws `FORBIDDEN` otherwise, which
 * Better Auth surfaces as the signup response.
 */
async function assertRegistrationAllowed(user: { email?: unknown }): Promise<void> {
  if (config.deployment !== 'hosted') return;
  const email = (typeof user.email === 'string' ? user.email : '').toLowerCase();
  const seeded = config.seedEmails.some((s) =>
    s.startsWith('@') ? email.endsWith(s) : s === email,
  );
  if (seeded) return;
  const invited = await prisma.invitation.findFirst({
    where: { email, status: 'pending', expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (invited) return;
  throw new APIError('FORBIDDEN', {
    message: 'Registration is by invitation only',
  });
}

// Module-level Redis client used by Better Auth for `secondaryStorage`. We
// don't reuse `RedisService` here because the Better Auth instance is itself
// module-level (consumed by `better-auth.middleware.ts`, `session.guard.ts`,
// and `ws-session.ts` at module load), and threading a Nest-DI'd service
// through those imports would require restructuring three call sites for
// no functional gain — the multiple Redis connections share the same Redis
// instance, which is what "shared rate-limit counters" actually requires.
// `RedisService.betterAuthSecondaryStorage()` exists for parity (and tests),
// using the same `createBetterAuthRedisStorage` adapter.
//
// Exported so the OAuth token refresher (`token-refresh.service.ts`) takes its
// per-account locks on this connection instead of opening a third client for a
// handful of `SET NX` calls every ten minutes.
export const betterAuthRedis = new Redis(config.redis.url, {
  lazyConnect: false,
  maxRetriesPerRequest: null,
});

// Audit log + abuse signals run against the singleton Prisma client. Better
// Auth's hooks fire from the Express middleware (mounted before Nest's
// controllers run), so DI isn't available at write time. We export these
// instances so `AuthModule` can re-register them as `useValue` providers —
// any code reaching them via DI sees the same instance the hooks use.
export const auditLogService = new AuditLogService(prisma);
export const abuseSignalsService = new AbuseSignalsService(prisma);
const auditHookDeps = { auditLog: auditLogService, abuseSignals: abuseSignalsService };
const auditAfterMiddleware = createAuditAfterMiddleware(auditHookDeps);
const organizationAuditHooks = createOrganizationAuditHooks(auditHookDeps);
// Refuses deletion of a user's only org (disjoint keys from the audit hooks —
// audit owns the `after*` events, the guard owns `beforeDeleteOrganization`).
const organizationGuardHooks = createOrganizationGuardHooks(prisma);

// Module-level singleton, mirrors the auditLogService pattern: Better Auth's
// `databaseHooks` fire from the Express middleware before Nest DI is available,
// so we share an instance constructed against the singleton Prisma client.
// `CredentialsService`'s constructor is typed against `PrismaService`, but it
// uses the structural `PrismaClient` shape only — the singleton satisfies it.
const credentialsService = new CredentialsService(prisma as unknown as PrismaService);

// OAuth → Credential mirror + unlink lifecycle. Lives in its own module
// (`oauth-mirror-hooks.ts`) alongside `audit-hooks` / `org-guard-hooks`; the
// deps below are the only things it needs from this file's singletons.
const oauthMirrorHooks = createOAuthMirrorHooks({
  credentials: credentialsService,
  membership: prisma,
  ensurePersonalOrgFor: (userId) => ensurePersonalOrgFor(userId),
  sessionFromHeaders: async (headers) => {
    // The link/callback endpoints don't run Better Auth's session middleware,
    // so `context.context.session` is null there — but the callback is a
    // top-level same-site navigation and still carries the session cookie.
    const res = await auth.api.getSession({ headers });
    const session = res?.session as
      | { userId?: unknown; activeOrganizationId?: unknown }
      | undefined;
    if (typeof session?.userId !== 'string') return null;
    return {
      userId: session.userId,
      activeOrganizationId:
        typeof session.activeOrganizationId === 'string' ? session.activeOrganizationId : null,
    };
  },
});

const bootLogger = new Logger('AuthConfig');
bootLogger.log(
  `Better Auth rate-limit mode=${config.deployment} storage=secondary-storage(redis)`,
);

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: config.betterAuth.secret,
  baseURL: config.betterAuth.baseURL,
  trustedOrigins: [config.corsOrigin],
  emailAndPassword: {
    enabled: true,
    // No email transport yet — see SPEC_PLAN cross-cutting note.
    requireEmailVerification: false,
  },
  emailVerification: {
    sendOnSignUp: false,
  },
  socialProviders: {
    ...(githubOAuth
      ? {
          github: {
            clientId: githubOAuth.clientId,
            clientSecret: githubOAuth.clientSecret,
            // `repo` (read+write code, contents, PRs), `project` (Projects v2
            // read+write — workflows update item status, not just read), and
            // `read:org` (Org-scoped lookups). Existing OAuth users see GitHub's
            // consent screen on next sign-in for the expanded scope set.
            scope: ['repo', 'project', 'read:org'],
          },
        }
      : {}),
    ...(gitlabOAuth
      ? {
          gitlab: {
            clientId: gitlabOAuth.clientId,
            clientSecret: gitlabOAuth.clientSecret,
            // `api` is the broad read+write API scope (equivalent in role to
            // GitHub's `repo + project`); `read_user` lets the profile-lookup
            // succeed.
            scope: ['api', 'read_user'],
          },
        }
      : {}),
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['github', 'gitlab'],
    },
  },
  // Redis-backed shared storage for rate-limit counters (and Better Auth's
  // session-cache reads, when the latter is enabled). Hosted deployments
  // running multiple API processes need a shared store so a flood across
  // processes still trips the rate limit. If Redis is unreachable at boot,
  // the ioredis client (above) throws synchronously, which fails the API
  // process — same posture as `RedisService` for `RunsGateway`.
  secondaryStorage: createBetterAuthRedisStorage(betterAuthRedis),
  // Mode-aware rate limiting. Local: lenient. Hosted: tuned per the
  // operational-hardening spec table. See `rate-limit-config.ts`.
  rateLimit: rateLimitConfig(config.deployment),
  // Audit-log writer. The path-dispatching middleware covers auth events
  // (sign-in success/failure, sign-up, sign-out, password reset). Org-
  // mutation events use the `organization` plugin's typed `organizationHooks`
  // so we get `previousRole` / typed `member`/`organization` payloads
  // without a synthetic re-query.
  hooks: { after: auditAfterMiddleware },
  // Auto-create one personal organization per new user and seed the
  // session's `activeOrganizationId`. This is the minimum needed for the
  // `@OrgId()` decorator to resolve on the user's first request after
  // signup. Polished naming + rename UI + multi-org switching live in
  // `org-on-signup-and-switching`.
  //
  // The work happens in `session.create.before` rather than
  // `user.create.after`. Better Auth runs `*.after` hooks via
  // `queueAfterTransactionHook`, which fires *after* `runWithTransaction`
  // unwinds — by then the brand-new session row is already persisted with
  // `activeOrganizationId = null`. By stamping the value during
  // `session.create.before`, we set it on the row at insert time, so the
  // very first cookie the client receives carries an active org and
  // `@OrgId()` resolves on the first authenticated request.
  databaseHooks: {
    // Registration gate (hosted only) + the `emailVerified` stamp.
    //
    // There is no email transport yet, so `emailVerification.sendOnSignUp` and
    // `emailAndPassword.requireEmailVerification` are both off and nothing
    // could ever flip `emailVerified` — it would sit `false` for every user
    // forever. Better Auth 1.7 turned that dormant field into a hard gate:
    // `/organization/list-user-invitations` 403s on an unverified session
    // unconditionally (no option disables it), which would break the pending-
    // invitations list for everyone. Stamping it at insert time keeps the
    // field meaning what it already effectively meant here. The actual
    // registration control is `assertRegistrationAllowed` above — invitation
    // rows, not verification state. Drop this stamp when real email
    // verification lands.
    user: {
      create: {
        async before(user) {
          await assertRegistrationAllowed(user);
          return { data: { ...user, emailVerified: true } };
        },
      },
    },
    session: {
      create: {
        async before(session) {
          const orgId = await ensurePersonalOrgFor(session.userId);
          return {
            data: {
              ...session,
              activeOrganizationId: orgId,
            },
          };
        },
      },
    },
    // Mirror Better Auth OAuth `account` rows into Conduit `Credential` rows.
    // `create` fires on first sign-in and on an in-app link; `update` fires on
    // re-authorization (e.g. consent re-prompt after a scope change) *and* on
    // every token refresh (`internalAdapter.updateAccount`, driven by
    // `token-refresh.service.ts`), at which point we refresh the encrypted
    // secret + recorded scopes + expiry in place;
    // `delete` is the unlink lifecycle (refuse while referenced, then clean
    // up the mirrored credential). See `oauth-mirror-hooks.ts`.
    account: oauthMirrorHooks,
  },
  // Enabled here so the schema lands in one db:push. The signup-time shim
  // that auto-creates a personal org + sets activeOrganizationId is owned
  // by the data-model-partitioning sub-feature and lands separately.
  plugins: [
    organization({
      organizationHooks: { ...organizationAuditHooks, ...organizationGuardHooks },
    }),
  ],
});

export type Auth = typeof auth;
