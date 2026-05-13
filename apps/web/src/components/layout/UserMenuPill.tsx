import {
  useMemo,
  useState,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useActiveOrganization,
  useCreateOrganization,
  useOrganizationMembers,
  useOrganizations,
  useSetActiveOrganization,
  useUserInvitations,
  type OrganizationSummary,
  type OrgRole,
} from '../../api/organization.js';
import { useSession, signOut } from '../../lib/auth-client.js';
import { cn } from '../../lib/cn.js';
import { Icon } from '../canvas/Icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../common/DropdownMenu.js';

const FILTER_THRESHOLD = 5;

interface SwitchOrgDeps {
  setActive: (args: { organizationId: string }) => Promise<unknown>;
  navigate: (to: string) => void;
  onAfterSwitch: () => void;
  setError: (msg: string | null) => void;
}

/**
 * Navigate home rather than staying on the current screen: every URL the
 * user is on may now reference rows in the previous org's tenant and would
 * 404. Cache invalidation is handled by useSetActiveOrganization.onSuccess.
 */
export async function switchOrganization(
  organizationId: string,
  deps: SwitchOrgDeps,
): Promise<boolean> {
  deps.setError(null);
  try {
    await deps.setActive({ organizationId });
    deps.onAfterSwitch();
    deps.navigate('/');
    return true;
  } catch (e) {
    deps.setError(e instanceof Error ? e.message : 'Could not switch');
    return false;
  }
}

interface CreateOrgDeps {
  createOrganization: (args: { name: string }) => Promise<{ id: string }>;
  setActive: (args: { organizationId: string }) => Promise<unknown>;
  navigate: (to: string) => void;
  onAfterSwitch: () => void;
  setError: (msg: string | null) => void;
}

export async function createAndSwitchOrganization(
  rawName: string,
  deps: CreateOrgDeps,
): Promise<boolean> {
  const name = rawName.trim();
  if (!name) return false;
  deps.setError(null);
  try {
    const created = await deps.createOrganization({ name });
    await deps.setActive({ organizationId: created.id });
    deps.onAfterSwitch();
    deps.navigate('/');
    return true;
  } catch (e) {
    deps.setError(e instanceof Error ? e.message : 'Could not create');
    return false;
  }
}

export function filterOtherOrgs(
  orgs: ReadonlyArray<{ id: string; name: string }>,
  activeOrgId: string | undefined,
  query: string,
): { id: string; name: string }[] {
  const q = query.trim().toLowerCase();
  return orgs
    .filter((o) => o.id !== activeOrgId)
    .filter((o) => !q || o.name.toLowerCase().includes(q));
}

export function UserMenuPill() {
  const { data } = useSession();
  const [open, setOpen] = useState(false);

  if (!data) return null;
  const user = data.user;
  const label = user.name?.trim() || user.email || 'Account';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <div className="pointer-events-auto inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg-panel)] font-mono text-[11px]">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Open user menu"
            className="flex items-center gap-2 px-2 py-[3px] text-[var(--color-text-2)] transition-colors hover:text-[var(--color-text)] data-[state=open]:text-[var(--color-text)]"
          >
            <span className="status-dot ok" aria-hidden />
            <span className="max-w-[180px] truncate" title={label}>
              {label}
            </span>
            <Icon name="chevron-down" size={12} />
          </button>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        aria-label="User menu"
        className="!w-[280px] !p-0"
      >
        <UserMenuBody
          email={user.email ?? null}
          name={user.name?.trim() || null}
          onClose={() => setOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface UserMenuBodyProps {
  name: string | null;
  email: string | null;
  onClose: () => void;
}

function UserMenuBody({ name, email, onClose }: UserMenuBodyProps) {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const { data: orgs = [] } = useOrganizations();
  const { data: activeOrg } = useActiveOrganization();
  const { data: members = [] } = useOrganizationMembers();
  const { data: invitations = [] } = useUserInvitations();
  const session = useSession();

  const userId = session.data?.user.id;
  const myMembership = members.find((m) => m.userId === userId);
  const myRole = myMembership?.role;

  const pendingInvitationCount = invitations.filter((i) => i.status === 'pending').length;

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
      onClose();
      navigate('/sign-in', { replace: true });
    }
  };

  const goTo = (path: string) => () => navigate(path);

  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius)]">
      <div className="border-b border-[var(--color-divider)] px-3 py-2.5">
        {name && (
          <div className="truncate font-sans text-[12px] font-medium text-[var(--color-text)]" title={name}>
            {name}
          </div>
        )}
        {email && (
          <div
            className={cn(
              'truncate font-mono text-[11px] text-[var(--color-text-muted)]',
              name ? 'mt-0.5' : '',
            )}
            title={email}
          >
            {email}
          </div>
        )}
      </div>

      <OrganizationSection
        orgs={orgs}
        activeOrg={activeOrg ?? null}
        myRole={myRole}
        onAfterSwitch={onClose}
      />

      <div className="flex flex-col border-t border-[var(--color-divider)] py-1">
        <NavMenuItem onSelect={goTo('/account')}>Account settings</NavMenuItem>
        <NavMenuItem onSelect={goTo('/account/organization')}>Organization settings</NavMenuItem>
        <NavMenuItem onSelect={goTo('/account/invitations')}>
          <span className="flex w-full items-center justify-between gap-2">
            <span>Pending invitations</span>
            {pendingInvitationCount > 0 && (
              <span
                aria-label={`${pendingInvitationCount} pending`}
                className="rounded-full bg-[var(--color-claude)] px-1.5 py-[1px] font-mono text-[10px] text-[var(--color-bg-panel)]"
              >
                {pendingInvitationCount}
              </span>
            )}
          </span>
        </NavMenuItem>
      </div>

      <div className="flex flex-col border-t border-[var(--color-divider)] py-1">
        <NavMenuItem
          onSelect={(e) => {
            // preventDefault keeps the menu open so "Signing out…" stays visible while the request is in flight.
            e.preventDefault();
            void handleSignOut();
          }}
          disabled={signingOut}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </NavMenuItem>
      </div>
    </div>
  );
}

function OrganizationSection({
  orgs,
  activeOrg,
  myRole,
  onAfterSwitch,
}: {
  orgs: OrganizationSummary[];
  activeOrg: OrganizationSummary | null;
  myRole: OrgRole | undefined;
  onAfterSwitch: () => void;
}) {
  const navigate = useNavigate();
  const setActive = useSetActiveOrganization();
  const create = useCreateOrganization();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSwitch = (id: string) =>
    switchOrganization(id, {
      setActive: (args) => setActive.mutateAsync(args),
      navigate,
      onAfterSwitch,
      setError,
    });

  const handleCreate = async (e: ReactFormEvent) => {
    e.preventDefault();
    const ok = await createAndSwitchOrganization(newName, {
      createOrganization: (args) => create.mutateAsync(args),
      setActive: (args) => setActive.mutateAsync(args),
      navigate,
      onAfterSwitch,
      setError,
    });
    if (ok) {
      setNewName('');
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 border-t border-[var(--color-divider)] px-3 py-2">
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
        Organization
      </div>
      <div className="font-mono text-[11.5px] text-[var(--color-text)]">
        <span className="truncate align-middle" title={activeOrg?.name ?? ''}>
          {activeOrg?.name ?? '—'}
        </span>
        {myRole && (
          <span className="ml-1.5 text-[var(--color-text-muted)]">· {myRole}</span>
        )}
      </div>

      {orgs.length > 1 && (
        <SwitchOrgList
          orgs={orgs}
          activeOrgId={activeOrg?.id}
          onSwitch={handleSwitch}
          isSwitching={setActive.isPending}
        />
      )}

      {creating ? (
        <form onSubmit={handleCreate} className="mt-1 flex items-center gap-1">
          <input
            value={newName}
            autoFocus
            placeholder="Organization name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setCreating(false);
                setNewName('');
                setError(null);
              }
            }}
            aria-label="New organization name"
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-text-muted)]"
          />
          <button
            type="submit"
            disabled={!newName.trim() || create.isPending || setActive.isPending}
            className="btn primary"
          >
            {create.isPending || setActive.isPending ? '…' : 'Create'}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="mt-1 flex w-full items-center gap-1 px-1 py-1 text-left font-mono text-[11px] text-[var(--color-text-2)] transition-colors hover:text-[var(--color-text)]"
        >
          <Icon name="plus" size={11} /> Create organization
        </button>
      )}

      {error && (
        <div role="alert" className="font-mono text-[10.5px] text-[var(--color-error)]">
          {error}
        </div>
      )}
    </div>
  );
}

function SwitchOrgList({
  orgs,
  activeOrgId,
  onSwitch,
  isSwitching,
}: {
  orgs: OrganizationSummary[];
  activeOrgId: string | undefined;
  onSwitch: (id: string) => unknown;
  isSwitching: boolean;
}) {
  const showFilter = orgs.length > FILTER_THRESHOLD;
  const [filter, setFilter] = useState('');
  const others = useMemo(
    () => filterOtherOrgs(orgs, activeOrgId, showFilter ? filter : ''),
    [orgs, activeOrgId, filter, showFilter],
  );

  // Radix DropdownMenu's roving focus / typeahead would steal keystrokes from
  // a plain input; stop propagation so typing in the filter behaves normally.
  const stopFilterKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') e.stopPropagation();
  };

  return (
    <div className="mt-1 flex flex-col gap-1">
      {showFilter && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={stopFilterKey}
          placeholder="Filter orgs…"
          aria-label="Filter organizations"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[10.5px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-text-muted)]"
        />
      )}
      <div className="max-h-[140px] overflow-y-auto" role="listbox" aria-label="Switch organization">
        {others.length === 0 ? (
          <div className="px-1 py-1 font-mono text-[10.5px] text-[var(--color-text-muted)]">
            {filter ? 'No matches' : 'No other organizations'}
          </div>
        ) : (
          others.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              onClick={() => void onSwitch(o.id)}
              disabled={isSwitching}
              className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left font-mono text-[11px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)] disabled:opacity-60"
              title={o.name}
            >
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function NavMenuItem({
  children,
  onSelect,
  disabled,
}: {
  children: React.ReactNode;
  onSelect: (event: Event) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      disabled={disabled}
      className="flex w-full items-center px-3 py-1.5 text-left font-mono text-[11px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </DropdownMenuItem>
  );
}
