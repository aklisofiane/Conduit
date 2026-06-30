import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  performInvitationAction,
  useAcceptInvitation,
  useInvitation,
  useRejectInvitation,
} from '../api/organization.js';
import { Button } from '../components/ui/button.js';

interface AcceptDeps {
  acceptInvitation: (id: string) => Promise<unknown>;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  setError: (msg: string | null) => void;
}

interface RejectDeps {
  rejectInvitation: (id: string) => Promise<unknown>;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  setError: (msg: string | null) => void;
}

export async function handleAcceptInvitation(
  invitationId: string,
  deps: AcceptDeps,
): Promise<void> {
  const ok = await performInvitationAction({
    invitationId,
    mutate: deps.acceptInvitation,
    setError: deps.setError,
  });
  if (ok) deps.navigate('/account/organization', { replace: true });
}

export async function handleRejectInvitation(
  invitationId: string,
  deps: RejectDeps,
): Promise<void> {
  const ok = await performInvitationAction({
    invitationId,
    mutate: deps.rejectInvitation,
    setError: deps.setError,
  });
  if (ok) deps.navigate('/account/invitations', { replace: true });
}

export function describeInvitationError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'It may have expired or been revoked.';
}

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
        className="text-title font-semibold leading-none tracking-tight text-[var(--color-text)]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        Invitation<em className="text-[var(--color-claude-mark)] not-italic">.</em>
      </h1>

      <section className="rounded-lg border border-[var(--color-divider)] bg-[var(--color-bg-panel)] p-5">
        {isLoading && (
          <p className="font-mono text-small text-[var(--color-text-muted)]">Loading invitation…</p>
        )}

        {error && (
          <div className="flex flex-col gap-2">
            <p className="font-mono text-small text-[var(--color-error)]">
              This invitation can't be opened.
            </p>
            <p className="font-mono text-small text-[var(--color-text-2)]">
              {describeInvitationError(error)}
            </p>
            <div>
              <Button
                onClick={() => navigate('/account/invitations', { replace: true })}
              >
                Back to invitations
              </Button>
            </div>
          </div>
        )}

        {data && !error && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-[140px_1fr] items-baseline gap-y-2">
              <dt className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
                Organization
              </dt>
              <dd className="font-mono text-base text-[var(--color-text)]">
                {data.organizationName ?? data.invitation.organizationId.slice(0, 8)}
              </dd>
              {data.inviterEmail && (
                <>
                  <dt className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
                    Invited by
                  </dt>
                  <dd className="font-mono text-small text-[var(--color-text)]">
                    {data.inviterEmail}
                  </dd>
                </>
              )}
              <dt className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
                Role
              </dt>
              <dd className="font-mono text-small text-[var(--color-text)]">
                {data.invitation.role}
              </dd>
              <dt className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
                Email
              </dt>
              <dd className="font-mono text-small text-[var(--color-text)]">
                {data.invitation.email}
              </dd>
            </dl>

            {actionError && (
              <p className="font-mono text-small text-[var(--color-error)]">{actionError}</p>
            )}

            <p className="font-mono text-small text-[var(--color-text-2)]">
              Accepting joins you as a member of this organization. Your active organization
              won't change automatically — switch via the user menu when you're ready.
            </p>

            <div className="flex justify-end gap-2">
              <Button
                onClick={handleReject}
                disabled={accept.isPending || reject.isPending}
              >
                {reject.isPending ? 'Rejecting…' : 'Reject'}
              </Button>
              <Button
                variant="primary"
                onClick={handleAccept}
                disabled={accept.isPending || reject.isPending}
              >
                {accept.isPending ? 'Accepting…' : 'Accept invitation'}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
