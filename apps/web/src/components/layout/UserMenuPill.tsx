import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent as ReactFormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  useActiveOrganization,
  useCreateOrganization,
  useOrganizationMembers,
  useOrganizations,
  useSetActiveOrganization,
  useUserInvitations,
  type OrganizationSummary,
} from '../../api/organization.js';
import { useSession, signOut } from '../../lib/auth-client.js';
import { cn } from '../../lib/cn.js';
import { Icon } from '../canvas/Icon.js';

const FILTER_THRESHOLD = 5;

interface SwitchOrgDeps {
  setActive: (args: { organizationId: string }) => Promise<unknown>;
  navigate: (to: string) => void;
  onAfterSwitch: () => void;
  setError: (msg: string | null) => void;
}

/**
 * Switch the active organization, invalidate org-scoped query keys (the
 * `useSetActiveOrganization` mutation handles invalidation in its onSuccess),
 * close the popover, and navigate home. The home page is the safe landing
 * because every URL the user is on may now reference rows in the previous
 * org's tenant and would 404.
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

/**
 * Create a new organization, switch to it, and navigate home. Trims and
 * validates the name; an empty name is a no-op so the popover doesn't
 * close on accidental submit.
 */
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

/**
 * Default `actionsSlot` content — pill for the signed-in user. The label
 * (status dot + name/email) is intentionally short and unchanged from the
 * minimal `web-auth-ui` shape; the popover gains an Organizations section
 * (active-org line, switch sub-list, create-org inline form) above the
 * existing Account-settings + Sign-out items.
 */
export function UserMenuPill() {
  const { data } = useSession();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
    setOpen((v) => !v);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  if (!data) return null;
  const user = data.user;
  const label = user.name?.trim() || user.email || 'Account';

  return (
    <>
      <div
        ref={anchorRef}
        className="pointer-events-auto inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg-panel)] font-mono text-[11px]"
      >
        <button
          type="button"
          onClick={toggle}
          aria-label="Open user menu"
          aria-expanded={open}
          className={cn(
            'flex items-center gap-2 px-2 py-[3px] text-[var(--color-text-2)] transition-colors hover:text-[var(--color-text)]',
            open && 'text-[var(--color-text)]',
          )}
        >
          <span className="status-dot ok" aria-hidden />
          <span className="max-w-[180px] truncate" title={label}>
            {label}
          </span>
          <Icon name="chevron-down" size={12} />
        </button>
      </div>

      {open && anchorRef.current && (
        <UserMenuPopover
          anchorEl={anchorRef.current}
          email={user.email ?? null}
          name={user.name?.trim() || null}
          onClose={close}
        />
      )}
    </>
  );
}

interface UserMenuPopoverProps {
  anchorEl: HTMLElement;
  name: string | null;
  email: string | null;
  onClose: () => void;
}

function UserMenuPopover({ anchorEl, name, email, onClose }: UserMenuPopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [position, setPosition] = useState({ top: 0, left: 0 });
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

  useLayoutEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const POPOVER_WIDTH = 280;
    setPosition({ top: rect.bottom + 6, left: rect.right - POPOVER_WIDTH });
  }, [anchorEl]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (anchorEl.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorEl, onClose]);

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

  const handleAccount = () => {
    onClose();
    navigate('/account');
  };

  const handleOrgSettings = () => {
    onClose();
    navigate('/account/organization');
  };

  const handleInvitations = () => {
    onClose();
    navigate('/account/invitations');
  };

  return createPortal(
    <div
      ref={popRef}
      role="menu"
      aria-label="User menu"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 50,
        width: 280,
      }}
      className="flex flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-bg-panel)] shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
    >
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
        <MenuItem onClick={handleAccount}>Account settings</MenuItem>
        <MenuItem onClick={handleOrgSettings}>Organization settings</MenuItem>
        <MenuItem onClick={handleInvitations}>
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
        </MenuItem>
      </div>

      <div className="flex flex-col border-t border-[var(--color-divider)] py-1">
        <MenuItem onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </MenuItem>
      </div>
    </div>,
    document.body,
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
  myRole: string | undefined;
  onAfterSwitch: () => void;
}) {
  const navigate = useNavigate();
  const setActive = useSetActiveOrganization();
  const create = useCreateOrganization();

  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const others = useMemo(
    () => filterOtherOrgs(orgs, activeOrg?.id, filter),
    [orgs, activeOrg, filter],
  );

  const showFilter = orgs.length > FILTER_THRESHOLD;

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
        <div className="mt-1 flex flex-col gap-1">
          {showFilter && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
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
                  onClick={() => void handleSwitch(o.id)}
                  disabled={setActive.isPending}
                  className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left font-mono text-[11px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)] disabled:opacity-60"
                  title={o.name}
                >
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
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

function MenuItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center px-3 py-1.5 text-left font-mono text-[11px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}
