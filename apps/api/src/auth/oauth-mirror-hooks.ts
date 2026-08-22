import { APIError, type BetterAuthOptions } from 'better-auth';
import { Logger } from '@nestjs/common';
import type { Platform } from '@conduit/shared/platform';
import type { CredentialsService } from '../modules/credentials/credentials.service';

type DatabaseHooks = NonNullable<BetterAuthOptions['databaseHooks']>;
type AccountHooks = NonNullable<DatabaseHooks['account']>;
type AccountDeleteBefore = NonNullable<NonNullable<AccountHooks['delete']>['before']>;
/** `GenericEndpointContext | null` without importing Better Auth's nested `@better-auth/core`. */
export type AuthHookContext = Parameters<AccountDeleteBefore>[1];
type AccountRow = Parameters<AccountDeleteBefore>[0];

/**
 * The only Better Auth endpoint that deletes a single `account` row. Every
 * other `account.delete` hook invocation comes from `deleteAccounts(userId)`
 * (full-user deletion), which fans the *same* hook out over every row via
 * `deleteManyWithHooks` — so the block-while-referenced guard is scoped to
 * this path, otherwise a user with a mirrored credential in use could never
 * be deleted.
 */
const UNLINK_ACCOUNT_PATH = '/unlink-account';

/** How many dependent connection names we name in the refusal message. */
const MAX_NAMED_CONNECTIONS = 5;

// ---------------------------------------------------------------------------
// Per-provider adapter table for the OAuth → Credential mirror
// ---------------------------------------------------------------------------

export interface OAuthProviderAdapter {
  platform: Platform;
  hostUrl: string;
  profileUrl: string;
  parseLogin: (json: Record<string, unknown>) => string | null;
}

export const OAUTH_PROVIDER_ADAPTERS: Record<string, OAuthProviderAdapter> = {
  github: {
    platform: 'GITHUB',
    hostUrl: 'github.com',
    profileUrl: 'https://api.github.com/user',
    parseLogin: (json) => (typeof json.login === 'string' ? json.login : null),
  },
  gitlab: {
    platform: 'GITLAB',
    hostUrl: 'gitlab.com',
    profileUrl: 'https://gitlab.com/api/v4/user',
    parseLogin: (json) => (typeof json.username === 'string' ? json.username : null),
  },
};

/**
 * Minimal structural slice of the Prisma client these hooks need: confirming
 * the user still belongs to the org their session points at before a
 * credential is written there.
 */
export interface OrgMembershipChecker {
  member: {
    count(args: { where: { userId: string; organizationId: string } }): Promise<number>;
  };
}

export interface OAuthMirrorDeps {
  credentials: Pick<
    CredentialsService,
    'upsertOAuthDerived' | 'findOAuthDerivedByAccountRow' | 'deleteOAuthDerivedByAccountRow'
  >;
  membership: OrgMembershipChecker;
  /** Personal-org fallback for hooks that fire without a request session. */
  ensurePersonalOrgFor: (userId: string) => Promise<string>;
  /**
   * Resolve the caller's session from the request headers. Better Auth only
   * populates `context.context.session` on endpoints that run its session
   * middleware — the OAuth *callback* (where the link mirror actually fires)
   * is not one of them, but it is a top-level same-site navigation, so it
   * still carries the session cookie. Returns `null` when there is no
   * session (or the lookup fails).
   */
  sessionFromHeaders: (
    headers: Headers,
  ) => Promise<{ userId: string; activeOrganizationId: string | null } | null>;
  /** Injectable for tests; defaults to global `fetch`. */
  fetchFn?: typeof fetch;
  logger?: Pick<Logger, 'warn' | 'error'>;
}

/**
 * Better Auth `databaseHooks.account` wiring for the OAuth → Credential
 * mirror and its unlink lifecycle.
 *
 * - `create.after` / `update.after` mirror the account row into a Conduit
 *   `Credential` (first sign-in, in-app link, re-authorization, refresh).
 * - `delete.before` refuses an unlink whose mirrored credential is still
 *   referenced by connections — the same posture `CredentialsService.delete()`
 *   takes for a manual credential.
 * - `delete.after` removes the mirrored credential once the unlink went
 *   through.
 */
export function createOAuthMirrorHooks(deps: OAuthMirrorDeps): AccountHooks {
  const logger = deps.logger ?? new Logger('OAuthMirror');
  const doFetch = deps.fetchFn ?? fetch;

  /**
   * Which org the mirrored credential belongs in.
   *
   * In-app linking happens while the user is signed in with an active org, so
   * that org owns the credential. First sign-in has no session yet (and the
   * account row is created before the first session), so we fall back to the
   * personal org. A session pointing at an org the user has since left is
   * ignored — the credential would be unreachable there.
   */
  async function resolveMirrorOrgId(userId: string, context: AuthHookContext): Promise<string> {
    const candidate = await activeOrgCandidate(userId, context);
    if (candidate) {
      const memberships = await deps.membership.member.count({
        where: { userId, organizationId: candidate },
      });
      if (memberships > 0) return candidate;
    }
    return deps.ensurePersonalOrgFor(userId);
  }

  async function activeOrgCandidate(
    userId: string,
    context: AuthHookContext,
  ): Promise<string | null> {
    const sessionOnContext = context?.context?.session?.session as
      | { userId?: unknown; activeOrganizationId?: unknown }
      | undefined;
    if (
      sessionOnContext?.userId === userId &&
      typeof sessionOnContext.activeOrganizationId === 'string' &&
      sessionOnContext.activeOrganizationId.length > 0
    ) {
      return sessionOnContext.activeOrganizationId;
    }
    const headers = context?.headers;
    if (!headers) return null;
    const fromRequest = await deps.sessionFromHeaders(headers).catch(() => null);
    if (!fromRequest || fromRequest.userId !== userId) return null;
    return fromRequest.activeOrganizationId ?? null;
  }

  /**
   * Mirror a fresh OAuth `account` row into a Conduit `Credential` so
   * downstream code (workers, MCP resolver, polling) keeps using the existing
   * Connection → Credential resolution path. Dispatches on
   * `account.providerId` via `OAUTH_PROVIDER_ADAPTERS` — unknown providers are
   * a no-op. Failures are logged but never propagate: a sign-in succeeding
   * without a mirror is recoverable (re-sign-in or manual PAT entry).
   */
  async function mirrorAccountToCredential(
    account: Partial<AccountRow> & Record<string, unknown>,
    context: AuthHookContext,
  ): Promise<void> {
    try {
      const providerId = typeof account.providerId === 'string' ? account.providerId : null;
      if (!providerId) return;
      const adapter = OAUTH_PROVIDER_ADAPTERS[providerId];
      if (!adapter) return; // Unknown provider — no-op.

      const accessToken = typeof account.accessToken === 'string' ? account.accessToken : null;
      const accountRowId = typeof account.id === 'string' ? account.id : null;
      const userId = typeof account.userId === 'string' ? account.userId : null;
      const providerAccountId = typeof account.accountId === 'string' ? account.accountId : null;
      if (!accessToken || !accountRowId || !userId || !providerAccountId) return;
      const scopes =
        typeof account.scope === 'string' && account.scope.length > 0
          ? account.scope
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      // Present for providers that expire access tokens (GitLab always; GitHub
      // only when the OAuth app has "Token Expiration: On"). Mirrored onto the
      // credential so the UI can show staleness, and refreshed in place every
      // time the token refresher renews the account row.
      const tokenExpiresAt =
        account.accessTokenExpiresAt instanceof Date ||
        typeof account.accessTokenExpiresAt === 'string'
          ? account.accessTokenExpiresAt
          : null;
      const orgId = await resolveMirrorOrgId(userId, context);
      const res = await doFetch(adapter.profileUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'conduit',
        },
      });
      if (!res.ok) {
        logger.warn(
          `${providerId} profile lookup failed (status=${res.status}); skipping mirror for account=${accountRowId}`,
        );
        return;
      }
      const profile = (await res.json()) as Record<string, unknown>;
      const providerLogin = adapter.parseLogin(profile) ?? providerAccountId;
      await deps.credentials.upsertOAuthDerived({
        orgId,
        accountRowId,
        providerAccountId,
        providerLogin,
        accessToken,
        scopes,
        platform: adapter.platform,
        hostUrl: adapter.hostUrl,
        tokenExpiresAt,
      });
    } catch (err) {
      logger.error(
        `Failed to mirror OAuth account to credential: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  return {
    create: {
      async after(account, context) {
        await mirrorAccountToCredential(account, context);
      },
    },
    update: {
      async after(account, context) {
        await mirrorAccountToCredential(account, context);
      },
    },
    delete: {
      async before(account, context) {
        // Full-user deletion fans this same hook over every account row (see
        // UNLINK_ACCOUNT_PATH); only an explicit unlink is refusable.
        if (context?.path !== UNLINK_ACCOUNT_PATH) return;
        const accountRowId = typeof account.id === 'string' ? account.id : null;
        if (!accountRowId) return;
        const mirrored = await deps.credentials.findOAuthDerivedByAccountRow(accountRowId);
        if (!mirrored || mirrored.dependentConnections.length === 0) return;
        throw new APIError('CONFLICT', {
          message: unlinkBlockedMessage(mirrored.name, mirrored.dependentConnections),
        });
      },
      async after(account) {
        const accountRowId = typeof account.id === 'string' ? account.id : null;
        if (!accountRowId) return;
        try {
          const result = await deps.credentials.deleteOAuthDerivedByAccountRow(accountRowId);
          if (result.status === 'referenced') {
            // Only reachable on the full-user-deletion path, where the
            // guard above deliberately stands down. Leave the row for the
            // org cascade rather than failing a committed delete.
            logger.warn(
              `Mirrored credential for account=${accountRowId} still referenced by ${result.dependentConnections.length} connection(s); left in place`,
            );
          }
        } catch (err) {
          logger.error(
            `Failed to delete mirrored credential for account=${accountRowId}: ${(err as Error).message}`,
            (err as Error).stack,
          );
        }
      },
    },
  };
}

/**
 * Names the connections standing in the way, mirroring the wording of
 * `CredentialsService.delete()`'s Conflict so both refusals read the same.
 */
export function unlinkBlockedMessage(credentialName: string, connectionNames: string[]): string {
  const shown = connectionNames.slice(0, MAX_NAMED_CONNECTIONS);
  const overflow = connectionNames.length - shown.length;
  const named = overflow > 0 ? `${shown.join(', ')} and ${overflow} more` : shown.join(', ');
  return `Credential "${credentialName}" is used by ${connectionNames.length} connection(s) — ${named}. Delete them first, then unlink.`;
}
