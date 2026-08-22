import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LINKED_ACCOUNTS_KEY } from '../api/linked-accounts.js';
import { LINK_FAILED_PARAM, LINK_RETURN_PARAM } from '../lib/account-linking.js';

export interface OAuthLinkReturn {
  /** Provider id when this page load is the tail of a successful link. */
  linkedProvider: string | null;
  /** Provider id when the round-trip came back through the error callback. */
  failedProvider: string | null;
  /** Better Auth's `?error=` code, e.g. `account_already_linked_to_different_user`. */
  errorCode: string | null;
}

/**
 * Reads the markers an OAuth link round-trip leaves on the return URL and
 * cleans them up.
 *
 * A successful link comes back to `?linked=<provider>`; the mirrored
 * `Credential` was written by the API's `account.create.after` hook during the
 * callback, so the credential list is invalidated here to make the new row
 * appear without a manual reload. A failed link comes back to
 * `?linkfailed=<provider>&error=<code>`.
 *
 * Both are captured once on mount and then stripped (`replace`) so a refresh
 * or a later navigation doesn't replay the banner.
 */
export function useOAuthLinkReturn(): OAuthLinkReturn {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();

  // Snapshot on first render — the effect below removes the params.
  const [state] = useState<OAuthLinkReturn>(() => ({
    linkedProvider: params.get(LINK_RETURN_PARAM),
    failedProvider: params.get(LINK_FAILED_PARAM),
    errorCode: params.get('error'),
  }));

  useEffect(() => {
    if (!state.linkedProvider && !state.failedProvider) return;
    if (state.linkedProvider) {
      void qc.invalidateQueries({ queryKey: LINKED_ACCOUNTS_KEY });
      void qc.invalidateQueries({ queryKey: ['credentials'] });
    }
    const next = new URLSearchParams(window.location.search);
    next.delete(LINK_RETURN_PARAM);
    next.delete(LINK_FAILED_PARAM);
    next.delete('error');
    setParams(next, { replace: true });
    // Mount-only by design: `state` is snapshotted once and `setParams` below
    // removes the very params this reads, so re-running would fight the strip.
  }, []);

  return state;
}
