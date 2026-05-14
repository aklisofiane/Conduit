import { betterAuth } from 'better-auth';
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
import { rateLimitConfig } from './rate-limit-config';

const githubOAuth = config.betterAuth.githubOAuth;

export const oauthProviders: readonly string[] = githubOAuth ? ['github'] : [];

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

// Module-level Redis client used by Better Auth for `secondaryStorage`. We
// don't reuse `RedisService` here because the Better Auth instance is itself
// module-level (consumed by `better-auth.middleware.ts`, `session.guard.ts`,
// and `ws-session.ts` at module load), and threading a Nest-DI'd service
// through those imports would require restructuring three call sites for
// no functional gain — the multiple Redis connections share the same Redis
// instance, which is what "shared rate-limit counters" actually requires.
// `RedisService.betterAuthSecondaryStorage()` exists for parity (and tests),
// using the same `createBetterAuthRedisStorage` adapter.
const betterAuthRedis = new Redis(config.redis.url, {
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

// Module-level singleton, mirrors the auditLogService pattern: Better Auth's
// `databaseHooks` fire from the Express middleware before Nest DI is available,
// so we share an instance constructed against the singleton Prisma client.
// `CredentialsService`'s constructor is typed against `PrismaService`, but it
// uses the structural `PrismaClient` shape only — the singleton satisfies it.
const credentialsService = new CredentialsService(prisma as unknown as PrismaService);
const oauthMirrorLogger = new Logger('GithubOAuthMirror');

const bootLogger = new Logger('AuthConfig');
bootLogger.log(
  `Better Auth rate-limit mode=${config.deployment} storage=secondary-storage(redis)`,
);

/**
 * Mirror a fresh GitHub OAuth `account` row into a Conduit `Credential` so
 * downstream code (workers, MCP resolver, polling) keeps using the existing
 * Connection → Credential resolution path. Failures are logged but never
 * propagate — a sign-in succeeding without a mirror is recoverable (re-sign-in
 * or manual PAT entry both work).
 */
async function mirrorGithubAccountToCredential(
  account: { id?: unknown; userId?: unknown; accountId?: unknown; accessToken?: unknown; scope?: unknown },
): Promise<void> {
  try {
    const accessToken = typeof account.accessToken === 'string' ? account.accessToken : null;
    const accountRowId = typeof account.id === 'string' ? account.id : null;
    const userId = typeof account.userId === 'string' ? account.userId : null;
    const githubAccountId = typeof account.accountId === 'string' ? account.accountId : null;
    if (!accessToken || !accountRowId || !userId || !githubAccountId) return;
    const scopes =
      typeof account.scope === 'string' && account.scope.length > 0
        ? account.scope.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    const orgId = await ensurePersonalOrgFor(userId);
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'conduit',
      },
    });
    if (!res.ok) {
      oauthMirrorLogger.warn(
        `GitHub /user lookup failed (status=${res.status}); skipping mirror for account=${accountRowId}`,
      );
      return;
    }
    const profile = (await res.json()) as { login?: unknown };
    const githubLogin = typeof profile.login === 'string' ? profile.login : githubAccountId;
    await credentialsService.upsertOAuthDerived({
      orgId,
      accountRowId,
      githubAccountId,
      githubLogin,
      accessToken,
      scopes,
    });
  } catch (err) {
    oauthMirrorLogger.error(
      `Failed to mirror GitHub OAuth account to credential: ${(err as Error).message}`,
      (err as Error).stack,
    );
  }
}

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
  socialProviders: githubOAuth
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
    : {},
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
    // Mirror Better Auth's GitHub OAuth `account` row into a Conduit
    // `Credential`. `create` fires on first sign-in; `update` fires on
    // re-authorization (e.g. consent re-prompt after a scope change), at
    // which point we refresh the encrypted secret + recorded scopes in place.
    account: {
      create: {
        async after(account) {
          if (account.providerId !== 'github') return;
          await mirrorGithubAccountToCredential(account);
        },
      },
      update: {
        async after(account) {
          if (account.providerId !== 'github') return;
          await mirrorGithubAccountToCredential(account);
        },
      },
    },
  },
  // Enabled here so the schema lands in one db:push. The signup-time shim
  // that auto-creates a personal org + sets activeOrganizationId is owned
  // by the data-model-partitioning sub-feature and lands separately.
  plugins: [organization({ organizationHooks: organizationAuditHooks })],
});

export type Auth = typeof auth;
