import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../../lib/cn.js';
import { SETTINGS_NAV } from '../settings/settings-nav.js';

/**
 * Sidebar is driven by `SETTINGS_NAV` so a new entry (e.g. "API keys") is one
 * config line plus one route registration.
 */
export function SettingsLayout() {
  return (
    <div className="flex flex-1">
      <aside className="w-[220px] shrink-0 border-r border-[var(--color-divider)] bg-[var(--color-bg-panel)] py-6">
        <div className="mb-3 px-5">
          <h2 className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
            Settings
          </h2>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {SETTINGS_NAV.map((entry) => {
            const IconComponent = entry.icon;
            return (
              <NavLink
                key={entry.key}
                to={entry.path}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-[var(--radius)] px-3 py-1.5 font-mono text-[12px] transition-colors',
                    isActive
                      ? 'bg-[var(--color-pill-bg)] text-[var(--color-text)]'
                      : 'text-[var(--color-text-2)] hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)]',
                  )
                }
              >
                <IconComponent size={14} strokeWidth={1.5} />
                <span>{entry.label}</span>
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
