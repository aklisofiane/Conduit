import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { relativeFromNow } from '../lib/time.js';
import {
  useAcceptInvitation,
  useRejectInvitation,
  useUserInvitations,
  type UserInvitation,
} from '../api/organization.js';

export function filterPendingInvitations(
  invitations: ReadonlyArray<UserInvitation>,
): UserInvitation[] {
  return invitations.filter((i) => i.status === 'pending');
}

interface InvitationActionDeps {
  invitationId: string;
  mutate: (id: string) => Promise<unknown>;
  setError: (msg: string | null) => void;
  onSettled?: () => void;
}

export async function performInvitationAction(deps: InvitationActionDeps): Promise<boolean> {
  deps.setError(null);
  try {
    await deps.mutate(deps.invitationId);
    deps.onSettled?.();
    return true;
  } catch (e) {
    deps.setError(e instanceof Error ? e.message : 'Action failed');
    return false;
  }
}

/**
 * `/account/invitations` — incoming pending invitations for the current user.
 * Accept lands on `/account/organization`; reject removes the row. v1 does
 * NOT auto-switch the active org on accept (see spec).
 */
export function InvitationsPage() {
  const { data: invitations = [], isLoading, refetch } = useUserInvitations();

  const pending = filterPendingInvitations(invitations);

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 pb-16 pt-10">
      <div>
        <h1
          className="text-[34px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Invitations<em className="text-[var(--color-claude)] not-italic">.</em>
        </h1>
        <p className="mt-2 font-mono text-[12px] text-[var(--color-text-2)]">
          Invitations sent to your email. Accepting joins you as a member; the active organization isn't changed.
        </p>
      </div>

      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
        <header className="border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="font-mono text-[13px] font-semibold">Pending</h2>
        </header>
        {isLoading && pending.length === 0 ? (
          <div className="px-4 py-4 font-mono text-[11px] text-[var(--color-text-muted)]">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="px-4 py-4 font-mono text-[11px] text-[var(--color-text-muted)]">
            No pending invitations.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {pending.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} onChange={() => void refetch()} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function InvitationRow({
  invitation,
  onChange,
}: {
  invitation: UserInvitation;
  onChange: () => void;
}) {
  const accept = useAcceptInvitation();
  const reject = useRejectInvitation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    const ok = await performInvitationAction({
      invitationId: invitation.id,
      mutate: (id) => accept.mutateAsync(id),
      setError,
    });
    if (ok) {
      onChange();
      navigate('/account/organization');
    }
  };

  const handleReject = async () => {
    const ok = await performInvitationAction({
      invitationId: invitation.id,
      mutate: (id) => reject.mutateAsync(id),
      setError,
    });
    if (ok) onChange();
  };

  const orgLabel = invitation.organizationName ?? `Organization ${invitation.organizationId.slice(0, 8)}`;

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <span className="truncate font-mono text-[12px] text-[var(--color-text)]" title={orgLabel}>
            {orgLabel}
          </span>
          <span className="font-mono text-[11px] text-[var(--color-text-2)]">
            invited as {invitation.role}
          </span>
        </div>
        <div className="font-mono text-[10.5px] text-[var(--color-text-muted)]">
          {invitation.inviterEmail ? `from ${invitation.inviterEmail} · ` : ''}
          expires {relativeFromNow(invitation.expiresAt)}
        </div>
        {error && (
          <div className="mt-1 font-mono text-[10.5px] text-[var(--color-error)]">{error}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button className="btn" onClick={handleReject} disabled={reject.isPending || accept.isPending}>
          {reject.isPending ? 'Rejecting…' : 'Reject'}
        </button>
        <button
          className="btn primary"
          onClick={handleAccept}
          disabled={reject.isPending || accept.isPending}
        >
          {accept.isPending ? 'Accepting…' : 'Accept'}
        </button>
      </div>
    </li>
  );
}
