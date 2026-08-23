import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAccounts, unlinkAccount } from '../lib/auth-client.js';
import type { LinkedAccount } from '../lib/account-linking.js';
import { AuthClientError, unwrapAuthResult } from './auth-result.js';

/**
 * Better Auth's `account` rows for the signed-in user. Not org-scoped (an
 * identity belongs to the user, not the workspace), so this key stays out of
 * `ORG_SCOPED_QUERY_KEYS` — but the *mirrored* credential is org-scoped, which
 * is why unlinking invalidates `['credentials']` too.
 */
export const LINKED_ACCOUNTS_KEY = ['linked-accounts'] as const;

export function useLinkedAccounts() {
  return useQuery({
    queryKey: LINKED_ACCOUNTS_KEY,
    queryFn: async () => unwrapAuthResult(await listAccounts()) as LinkedAccount[],
  });
}

export interface UnlinkAccountArgs {
  /**
   * The Better Auth `account` **row** id — `LinkedAccount.id`, not the
   * provider-side user id. Since 1.7 this is the only selector `/unlink-account`
   * accepts: accounts are keyed on `(issuer, accountId)`, so `providerId` alone
   * no longer identifies a row.
   */
  accountId: string;
}

/**
 * Unlink is refused by the server in two cases the UI has to surface: it's the
 * user's last account (Better Auth), or the mirrored credential is still
 * referenced by connections (the API's `account.delete.before` hook). Both
 * arrive as an `AuthClientError`; `unlinkErrorMessage` turns them into copy.
 */
export function useUnlinkAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: UnlinkAccountArgs) => {
      const res = await unlinkAccount(args);
      if (res.error) throw new AuthClientError(res.error, 'Could not unlink this account.');
      return true;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: LINKED_ACCOUNTS_KEY }),
        qc.invalidateQueries({ queryKey: ['credentials'] }),
        qc.invalidateQueries({ queryKey: ['connections'] }),
      ]);
    },
  });
}
