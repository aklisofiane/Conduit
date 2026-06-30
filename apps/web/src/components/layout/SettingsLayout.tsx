import { NavLink, Outlet } from 'react-router-dom';
import { useUserInvitations } from '../../api/organization.js';
import { cn } from '../../lib/cn.js';
import { SETTINGS_NAV } from '../settings/settings-nav.js';

/**
 * Sidebar is driven by `SETTINGS_NAV` so a new entry (e.g. "API keys") is one
 * config line plus one route registration. `SETTINGS_NAV` is static config, so
 * the live pending-invitations badge is resolved here per `entry.key`.
 */
export function SettingsLayout() {
  const { data: invitations = [] } = useUserInvitations();
  const pendingInvitationCount = invitations.filter((i) => i.status === 'pending').length;

  return (
    <div className="flex flex-1">
      <aside className="w-[220px] shrink-0 border-r border-[var(--color-divider)] bg-[var(--color-bg-panel)] py-6">
        <div className="mb-3 px-5">
          <h2 className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
            Settings
          </h2>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {SETTINGS_NAV.map((entry) => {
            const IconComponent = entry.icon;
            const badgeCount = entry.key === 'invitations' ? pendingInvitationCount : 0;
            return (
              <NavLink
                key={entry.key}
                to={entry.path}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-[var(--radius)] px-3 py-1.5 font-mono text-small transition-colors',
                    isActive
                      ? 'bg-[var(--color-pill-bg)] text-[var(--color-text)]'
                      : 'text-[var(--color-text-2)] hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)]',
                  )
                }
              >
                <IconComponent size={14} strokeWidth={1.5} />
                <span>{entry.label}</span>
                {badgeCount > 0 && (
                  <span
                    aria-label={`${badgeCount} pending`}
                    className="ml-auto rounded-full bg-[var(--color-claude-mark)] px-1.5 py-[1px] font-mono text-caption text-[var(--color-bg-panel)]"
                  >
                    {badgeCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
