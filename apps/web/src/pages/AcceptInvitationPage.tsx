import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useAcceptInvitation,
  useInvitation,
  useRejectInvitation,
} from '../api/organization.js';

interface InvitationActionDeps {
  acceptInvitation: (id: string) => Promise<unknown>;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  setError: (msg: string | null) => void;
}

export async function handleAcceptInvitation(
  invitationId: string,
  deps: InvitationActionDeps,
): Promise<void> {
  deps.setError(null);
  try {
    await deps.acceptInvitation(invitationId);
    deps.navigate('/account/organization', { replace: true });
  } catch (e) {
    deps.setError(e instanceof Error ? e.message : 'Could not accept');
  }
}

export async function handleRejectInvitation(
  invitationId: string,
  deps: {
    rejectInvitation: (id: string) => Promise<unknown>;
    navigate: (to: string, opts?: { replace?: boolean }) => void;
    setError: (msg: string | null) => void;
  },
): Promise<void> {
  deps.setError(null);
  try {
    await deps.rejectInvitation(invitationId);
    deps.navigate('/account/invitations', { replace: true });
  } catch (e) {
    deps.setError(e instanceof Error ? e.message : 'Could not reject');
  }
}

export function describeInvitationError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'It may have expired or been revoked.';
}

/**
 * `/accept-invitation/:invitationId` — deep-link target shared via the
 * copyable invite URL fallback (see `OrganizationSettingsPage`'s invite
 * form). Lives inside `RequireAuth` so unauthed visitors are redirected
 * to `/sign-in?next=…` and land back here after sign-in.
 *
 * Per spec: accepting does NOT auto-switch the active org. The user
 * navigates to `/account/organization` and picks their context via the
 * user menu if they want to switch.
 */
export function AcceptInvitationPage() {
  const { invitationId } = useParams<{ invitationId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useInvitation(invitationId);
  const accept = useAcceptInvitation();
  const reject = useRejectInvitation();
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (!invitationId) return;
    await handleAcceptInvitation(invitationId, {
      acceptInvitation: (id) => accept.mutateAsync(id),
      navigate,
      setError: setActionError,
    });
  };

  const handleReject = async () => {
    if (!invitationId) return;
    await handleRejectInvitation(invitationId, {
      rejectInvitation: (id) => reject.mutateAsync(id),
      navigate,
      setError: setActionError,
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-6 px-6 pb-16 pt-16">
      <h1
        className="text-[28px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        Invitation<em className="text-[var(--color-claude)] not-italic">.</em>
      </h1>

      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)] p-5">
        {isLoading && (
          <p className="font-mono text-[12px] text-[var(--color-text-muted)]">Loading invitation…</p>
        )}

        {error && (
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[12px] text-[var(--color-error)]">
              This invitation can't be opened.
            </p>
            <p className="font-mono text-[11px] text-[var(--color-text-2)]">
              {describeInvitationError(error)}
            </p>
            <div>
              <button
                className="btn"
                onClick={() => navigate('/account/invitations', { replace: true })}
              >
                Back to invitations
              </button>
            </div>
          </div>
        )}

        {data && !error && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-[140px_1fr] items-baseline gap-y-2">
              <dt className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
                Organization
              </dt>
              <dd className="font-mono text-[13px] text-[var(--color-text)]">
                {data.organizationName ?? data.invitation.organizationId.slice(0, 8)}
              </dd>
              {data.inviterEmail && (
                <>
                  <dt className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
                    Invited by
                  </dt>
                  <dd className="font-mono text-[12.5px] text-[var(--color-text)]">
                    {data.inviterEmail}
                  </dd>
                </>
              )}
              <dt className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
                Role
              </dt>
              <dd className="font-mono text-[12.5px] text-[var(--color-text)]">
                {data.invitation.role}
              </dd>
              <dt className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
                Email
              </dt>
              <dd className="font-mono text-[12.5px] text-[var(--color-text)]">
                {data.invitation.email}
              </dd>
            </dl>

            {actionError && (
              <p className="font-mono text-[11px] text-[var(--color-error)]">{actionError}</p>
            )}

            <p className="font-mono text-[11px] text-[var(--color-text-2)]">
              Accepting joins you as a member of this organization. Your active organization
              won't change automatically — switch via the user menu when you're ready.
            </p>

            <div className="flex justify-end gap-2">
              <button
                className="btn"
                onClick={handleReject}
                disabled={accept.isPending || reject.isPending}
              >
                {reject.isPending ? 'Rejecting…' : 'Reject'}
              </button>
              <button
                className="btn primary"
                onClick={handleAccept}
                disabled={accept.isPending || reject.isPending}
              >
                {accept.isPending ? 'Accepting…' : 'Accept invitation'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
