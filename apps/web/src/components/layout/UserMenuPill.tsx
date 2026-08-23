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
import { ChevronDown, Plus, Settings } from 'lucide-react';
import { SETTINGS_NAV } from '../settings/settings-nav.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';

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
      <div className="pointer-events-auto inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg-panel)] font-mono text-small">
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
            <ChevronDown size={12} strokeWidth={1.5} />
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
          <div
            className="truncate font-sans text-small font-medium text-[var(--color-text)]"
            title={name}
          >
            {name}
          </div>
        )}
        {email && (
          <div
            className={cn(
              'truncate font-mono text-small text-[var(--color-text-muted)]',
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
        <div className="flex items-center gap-2 px-3 py-1.5 font-mono text-small font-medium text-[var(--color-text)]">
          <Settings size={14} strokeWidth={1.5} />
          <span>Settings</span>
        </div>
        {SETTINGS_NAV.map((entry) => {
          const Icon = entry.icon;
          const badge = entry.key === 'invitations' ? pendingInvitationCount : 0;
          return (
            <NavMenuItem key={entry.key} onSelect={goTo(entry.path)}>
              <span className="flex w-full items-center gap-2 pl-4">
                <Icon size={14} strokeWidth={1.5} />
                <span>{entry.label}</span>
                {badge > 0 && (
                  <span
                    aria-label={`${badge} pending`}
                    className="ml-auto rounded-full bg-[var(--color-claude-mark)] px-1.5 py-[1px] font-mono text-caption text-[var(--color-bg-panel)]"
                  >
                    {badge}
                  </span>
                )}
              </span>
            </NavMenuItem>
          );
        })}
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
      <div className="font-mono text-caption uppercase tracking-wider text-[var(--color-text-muted)]">
        Organization
      </div>
      <div className="font-mono text-caption text-[var(--color-text)]">
        <span className="truncate align-middle" title={activeOrg?.name ?? ''}>
          {activeOrg?.name ?? '—'}
        </span>
        {myRole && <span className="ml-1.5 text-[var(--color-text-muted)]">· {myRole}</span>}
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
          <Input
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
            variant="compact"
            className="min-w-0 w-auto flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!newName.trim() || create.isPending || setActive.isPending}
          >
            {create.isPending || setActive.isPending ? '…' : 'Create'}
          </Button>
        </form>
      ) : (
        <Button
          variant="ghost"
          onClick={() => setCreating(true)}
          className="mt-1 w-full justify-start gap-1 h-auto rounded-none border-0 px-1 py-1 text-left font-mono text-small text-[var(--color-text-2)] hover:bg-transparent hover:text-[var(--color-text)]"
        >
          <Plus size={11} strokeWidth={1.5} /> Create organization
        </Button>
      )}

      {error && (
        <div role="alert" className="font-mono text-caption text-[var(--color-error)]">
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
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={stopFilterKey}
          placeholder="Filter orgs…"
          aria-label="Filter organizations"
          variant="compact"
          className="text-caption"
        />
      )}
      <div
        className="max-h-[140px] overflow-y-auto"
        role="listbox"
        aria-label="Switch organization"
      >
        {others.length === 0 ? (
          <div className="px-1 py-1 font-mono text-caption text-[var(--color-text-muted)]">
            {filter ? 'No matches' : 'No other organizations'}
          </div>
        ) : (
          others.map((o) => (
            <Button
              key={o.id}
              variant="ghost"
              role="option"
              onClick={() => void onSwitch(o.id)}
              disabled={isSwitching}
              title={o.name}
              className="w-full justify-start gap-2 h-auto rounded-[var(--radius-sm)] px-2 py-1 text-left font-mono text-small text-[var(--color-text-2)] hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)] disabled:opacity-60"
            >
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
            </Button>
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
      className="flex w-full items-center px-3 py-1.5 text-left font-mono text-small text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </DropdownMenuItem>
  );
}
