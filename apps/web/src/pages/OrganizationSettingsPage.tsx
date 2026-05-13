import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSession } from '../lib/auth-client.js';
import { relativeFromNow } from '../lib/time.js';
import { InlineRename } from '../components/common/InlineRename.js';
import { Select } from '../components/common/Select.js';
import {
  buildInviteUrl,
  ORG_ROLES,
  useActiveOrganization,
  useCancelInvitation,
  useDeleteOrganization,
  useInviteMember,
  useLeaveOrganization,
  useOrganizationInvitations,
  useOrganizationMembers,
  useRemoveMember,
  useUpdateMemberRole,
  useUpdateOrganization,
  type OrganizationMember,
  type OrgRole,
} from '../api/organization.js';

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email'),
  role: z.enum(ORG_ROLES),
});

export type InviteValues = z.infer<typeof inviteSchema>;

interface InviteDeps {
  inviteMember: (args: InviteValues) => Promise<{ id: string } | { error: { message?: string; status?: number } }>;
  setError: UseFormSetError<InviteValues>;
  onSuccess: (invitationId: string) => void;
}

export async function submitInvite(values: InviteValues, deps: InviteDeps): Promise<void> {
  try {
    const res = await deps.inviteMember(values);
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      deps.setError('root', {
        type: 'server',
        message: res.error.message ?? 'Could not send invitation',
      });
      return;
    }
    if (res && 'id' in res) deps.onSuccess(res.id);
  } catch (e) {
    deps.setError('root', {
      type: 'server',
      message: e instanceof Error ? e.message : 'Could not send invitation',
    });
  }
}

/** True iff the only remaining owner of an org with members is the user. */
export function isSoleOwner(args: { members: OrganizationMember[]; userId: string | undefined }): boolean {
  const { members, userId } = args;
  if (!userId) return false;
  if (members.length <= 1) return false;
  const owners = members.filter((m) => m.role === 'owner');
  return owners.length === 1 && owners[0]?.userId === userId;
}

export function canManageMember(actorRole: OrgRole | undefined, targetRole: OrgRole): boolean {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin' && targetRole !== 'owner') return true;
  return false;
}

export function OrganizationSettingsPage() {
  const { data: org, isLoading: orgLoading } = useActiveOrganization();
  const { data: members = [], isLoading: membersLoading } = useOrganizationMembers();
  const { data: invitations = [] } = useOrganizationInvitations();
  const session = useSession();

  if (orgLoading || !org) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-6 pt-10 font-mono text-[12px] text-[var(--color-text-muted)]">
        Loading…
      </div>
    );
  }

  const userId = session.data?.user.id;
  const me = members.find((m) => m.userId === userId);
  const myRole = me?.role;

  const pendingInvitations = invitations.filter((i) => i.status === 'pending');

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 pb-16 pt-10">
      <OrganizationHeader
        name={org.name}
        createdAt={org.createdAt}
        memberCount={members.length}
        myRole={myRole}
        canRename={myRole === 'owner' || myRole === 'admin'}
        organizationId={org.id}
      />

      <MembersSection
        members={members}
        loading={membersLoading}
        myUserId={userId}
        myRole={myRole}
      />

      <PendingInvitationsSection
        invitations={pendingInvitations}
        canManage={myRole === 'owner' || myRole === 'admin'}
      />

      {(myRole === 'owner' || myRole === 'admin') && <InviteMemberSection />}

      <DangerZoneSection
        members={members}
        myUserId={userId}
        myRole={myRole}
        organizationId={org.id}
        organizationName={org.name}
      />
    </div>
  );
}

function OrganizationHeader({
  name,
  createdAt,
  memberCount,
  myRole,
  canRename,
  organizationId,
}: {
  name: string;
  createdAt: string | Date;
  memberCount: number;
  myRole: OrgRole | undefined;
  canRename: boolean;
  organizationId: string;
}) {
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateOrganization(organizationId);

  const handleCommit = async (next: string) => {
    const trimmed = next.trim();
    if (!trimmed || trimmed === name) {
      setRenaming(false);
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ name: trimmed });
      setRenaming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename');
    }
  };

  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 py-4">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <InlineRename
              initial={name}
              saving={update.isPending}
              onCommit={handleCommit}
              onCancel={() => setRenaming(false)}
              className="w-full max-w-[420px] rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg)] px-2 py-1 text-[24px] font-semibold text-[var(--color-text)] outline-none [font-family:var(--font-serif)] focus:border-[var(--color-text-muted)]"
            />
          ) : (
            <h1
              className="truncate text-[28px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
              style={{ fontFamily: 'var(--font-serif)' }}
              title={name}
            >
              {name}
              <em className="text-[var(--color-claude)] not-italic">.</em>
            </h1>
          )}
          <p className="mt-2 font-mono text-[11.5px] text-[var(--color-text-2)]">
            Created {relativeFromNow(createdAt)} · {memberCount} member{memberCount === 1 ? '' : 's'}
          </p>
          {error && (
            <p className="mt-1 font-mono text-[11px] text-[var(--color-error)]">{error}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {myRole && (
            <span className="rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-pill-bg)] px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-2)]">
              {myRole}
            </span>
          )}
          {canRename && !renaming && (
            <button
              className="btn"
              onClick={() => {
                setError(null);
                setRenaming(true);
              }}
            >
              Rename
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function MembersSection({
  members,
  loading,
  myUserId,
  myRole,
}: {
  members: OrganizationMember[];
  loading: boolean;
  myUserId: string | undefined;
  myRole: OrgRole | undefined;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <header className="border-b border-[var(--color-line)] px-4 py-3">
        <h2 className="font-mono text-[13px] font-semibold">Members</h2>
      </header>
      {loading && members.length === 0 ? (
        <div className="px-4 py-4 font-mono text-[11px] text-[var(--color-text-muted)]">Loading…</div>
      ) : members.length === 0 ? (
        <div className="px-4 py-4 font-mono text-[11px] text-[var(--color-text-muted)]">
          No members yet.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isMe={m.userId === myUserId}
              canManage={canManageMember(myRole, m.role) && m.userId !== myUserId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function MemberRow({
  member,
  isMe,
  canManage,
}: {
  member: OrganizationMember;
  isMe: boolean;
  canManage: boolean;
}) {
  const remove = useRemoveMember();
  const updateRole = useUpdateMemberRole();
  const [error, setError] = useState<string | null>(null);

  const display = member.user.name?.trim() || member.user.email;

  const handleRemove = async () => {
    if (!window.confirm(`Remove ${display} from this organization?`)) return;
    setError(null);
    try {
      await remove.mutateAsync(member.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove');
    }
  };

  const handleRoleChange = async (next: OrgRole) => {
    setError(null);
    try {
      await updateRole.mutateAsync({ memberId: member.id, role: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change role');
    }
  };

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--color-pill-bg)] font-mono text-[10px] uppercase text-[var(--color-text-2)]"
        >
          {initials(display)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[12px] text-[var(--color-text)]" title={display}>
              {display}
            </span>
            {isMe && (
              <span className="font-mono text-[10px] text-[var(--color-text-muted)]">(you)</span>
            )}
          </div>
          <div className="font-mono text-[10.5px] text-[var(--color-text-muted)]">
            joined {relativeFromNow(member.createdAt)}
          </div>
          {error && (
            <div className="mt-1 font-mono text-[10.5px] text-[var(--color-error)]">{error}</div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canManage ? (
          <Select
            ariaLabel="Role"
            value={member.role}
            disabled={updateRole.isPending}
            onValueChange={(v) => handleRoleChange(v as OrgRole)}
            className="!w-auto !h-7 !px-2"
            options={ORG_ROLES.map((r) => ({ value: r, label: r }))}
          />
        ) : (
          <span className="font-mono text-[11px] text-[var(--color-text-2)]">{member.role}</span>
        )}
        {canManage && (
          <button
            className="btn"
            onClick={handleRemove}
            disabled={remove.isPending}
            aria-label={`Remove ${display}`}
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

function PendingInvitationsSection({
  invitations,
  canManage,
}: {
  invitations: ReadonlyArray<{
    id: string;
    email: string;
    role: OrgRole;
    expiresAt: string | Date;
  }>;
  canManage: boolean;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <header className="border-b border-[var(--color-line)] px-4 py-3">
        <h2 className="font-mono text-[13px] font-semibold">Pending invitations</h2>
      </header>
      {invitations.length === 0 ? (
        <div className="px-4 py-4 font-mono text-[11px] text-[var(--color-text-muted)]">
          No pending invitations.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {invitations.map((inv) => (
            <InvitationRow key={inv.id} invitation={inv} canManage={canManage} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InvitationRow({
  invitation,
  canManage,
}: {
  invitation: { id: string; email: string; role: OrgRole; expiresAt: string | Date };
  canManage: boolean;
}) {
  const cancel = useCancelInvitation();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inviteUrl = buildInviteUrl(invitation.id);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed');
    }
  };

  const handleRevoke = async () => {
    setError(null);
    try {
      await cancel.mutateAsync(invitation.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke');
    }
  };

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <span
            className="truncate font-mono text-[12px] text-[var(--color-text)]"
            title={invitation.email}
          >
            {invitation.email}
          </span>
          <span className="font-mono text-[11px] text-[var(--color-text-2)]">{invitation.role}</span>
        </div>
        <div className="font-mono text-[10.5px] text-[var(--color-text-muted)]">
          expires {relativeFromNow(invitation.expiresAt)}
        </div>
        {error && (
          <div className="mt-1 font-mono text-[10.5px] text-[var(--color-error)]">{error}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button className="btn" onClick={handleCopy} aria-label="Copy invite URL">
          {copied ? 'Copied' : 'Copy invite URL'}
        </button>
        {canManage && (
          <button className="btn" onClick={handleRevoke} disabled={cancel.isPending}>
            Revoke
          </button>
        )}
      </div>
    </li>
  );
}

function InviteMemberSection() {
  const invite = useInviteMember();
  const [created, setCreated] = useState<{ id: string; email: string } | null>(null);

  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: 'member' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setCreated(null);
    await submitInvite(values, {
      inviteMember: async (args) => {
        try {
          const inv = await invite.mutateAsync(args);
          return { id: inv.id };
        } catch (e) {
          return {
            error: {
              message: e instanceof Error ? e.message : String(e),
              status: (e as { status?: number })?.status,
            },
          };
        }
      },
      setError: form.setError,
      onSuccess: (id) => {
        setCreated({ id, email: values.email });
        form.reset({ email: '', role: values.role });
      },
    });
  });

  const rootError = form.formState.errors.root?.message;
  const inviteUrl = created ? buildInviteUrl(created.id) : null;

  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <header className="border-b border-[var(--color-line)] px-4 py-3">
        <h2 className="font-mono text-[13px] font-semibold">Invite member</h2>
      </header>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 px-4 py-4" noValidate>
        <div className="grid grid-cols-[1fr_140px_auto] items-end gap-3">
          <label className="flex flex-col">
            <span className="field-label">Email</span>
            <input
              className="field-input"
              type="email"
              autoComplete="email"
              {...form.register('email')}
            />
            {form.formState.errors.email?.message && (
              <span className="mt-1 font-mono text-[10.5px] text-[var(--color-error)]">
                {form.formState.errors.email.message}
              </span>
            )}
          </label>
          <label className="flex flex-col">
            <span className="field-label">Role</span>
            <Controller
              name="role"
              control={form.control}
              render={({ field }) => (
                <Select
                  ariaLabel="Role"
                  value={field.value}
                  onValueChange={field.onChange}
                  options={ORG_ROLES.map((r) => ({ value: r, label: r }))}
                />
              )}
            />
          </label>
          <button
            type="submit"
            className="btn primary"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? 'Sending…' : 'Send'}
          </button>
        </div>

        {rootError && (
          <div role="alert" className="font-mono text-[11px] text-[var(--color-error)]">
            {rootError}
          </div>
        )}

        {created && inviteUrl && (
          <div
            role="status"
            className="rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-2)]"
          >
            <div className="text-[var(--color-success)]">
              Invitation created · share this link with {created.email}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-[10.5px] text-[var(--color-text)]">
                {inviteUrl}
              </code>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteUrl);
                  } catch {
                    /* no-op */
                  }
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}

function DangerZoneSection({
  members,
  myUserId,
  myRole,
  organizationId,
  organizationName,
}: {
  members: OrganizationMember[];
  myUserId: string | undefined;
  myRole: OrgRole | undefined;
  organizationId: string;
  organizationName: string;
}) {
  const navigate = useNavigate();
  const leave = useLeaveOrganization();
  const remove = useDeleteOrganization();

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const soleOwner = useMemo(
    () => isSoleOwner({ members, userId: myUserId }),
    [members, myUserId],
  );
  const canDelete = myRole === 'owner';

  const handleLeave = async () => {
    if (!window.confirm(`Leave ${organizationName}?`)) return;
    setLeaveError(null);
    try {
      await leave.mutateAsync(organizationId);
      navigate('/', { replace: true });
    } catch (e) {
      setLeaveError(e instanceof Error ? e.message : 'Could not leave');
    }
  };

  const handleDelete = async () => {
    if (confirmName !== organizationName) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(organizationId);
      navigate('/', { replace: true });
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete');
    }
  };

  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <header className="border-b border-[var(--color-line)] px-4 py-3">
        <h2 className="font-mono text-[13px] font-semibold">Danger zone</h2>
      </header>
      <div className="flex flex-col gap-4 px-4 py-4">
        {!soleOwner && (
          <div className="flex items-center justify-between gap-4">
            <div className="font-mono text-[11.5px] text-[var(--color-text-2)]">
              Leave this organization. Your access is removed; the org keeps running.
            </div>
            <button className="btn" onClick={handleLeave} disabled={leave.isPending}>
              {leave.isPending ? 'Leaving…' : 'Leave organization'}
            </button>
          </div>
        )}
        {leaveError && (
          <div className="font-mono text-[10.5px] text-[var(--color-error)]">{leaveError}</div>
        )}

        {canDelete && (
          <div className="flex flex-col gap-2 border-t border-[var(--color-line)] pt-4">
            <div className="flex items-center justify-between gap-4">
              <div className="font-mono text-[11.5px] text-[var(--color-text-2)]">
                Permanently delete this organization and everything inside it.
              </div>
              {!confirmingDelete && (
                <button className="btn" onClick={() => setConfirmingDelete(true)}>
                  Delete organization
                </button>
              )}
            </div>
            {confirmingDelete && (
              <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg)] p-3">
                <div className="font-mono text-[11px] text-[var(--color-text)]">
                  Type <code className="text-[var(--color-claude)]">{organizationName}</code> to confirm.
                </div>
                <input
                  className="field-input"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  autoFocus
                />
                {deleteError && (
                  <div className="font-mono text-[10.5px] text-[var(--color-error)]">{deleteError}</div>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    className="btn"
                    onClick={() => {
                      setConfirmingDelete(false);
                      setConfirmName('');
                      setDeleteError(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    disabled={confirmName !== organizationName || remove.isPending}
                    onClick={handleDelete}
                  >
                    {remove.isPending ? 'Deleting…' : 'Permanently delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function initials(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return trimmed.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
