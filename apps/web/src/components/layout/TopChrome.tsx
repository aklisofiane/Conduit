import { NavLink } from 'react-router-dom';
import { Icon } from '../canvas/Icon.js';
import { useTopbarSlotsStore } from '../../state/topbar-slots.js';

/**
 * Global app chrome — three-column grid:
 *   left   · brand + Home + Settings nav-icons
 *   center · slot (e.g. workflow Build/Runs/History tabs)
 *   right  · slot (e.g. Save/Test run) — falls back to the services pill
 *
 * Pages populate the center/right slots via `useTopbarSlots(...)` so the
 * chrome stays presentational and routing stays decoupled from layout.
 */
export function TopChrome() {
  const centerSlot = useTopbarSlotsStore((s) => s.centerSlot);
  const actionsSlot = useTopbarSlotsStore((s) => s.actionsSlot);

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-divider)] bg-[var(--color-bg-panel)]">
      <div
        className="grid h-12 items-center gap-4 px-4"
        style={{ gridTemplateColumns: '1fr auto 1fr' }}
      >
        {/* Left — brand + nav */}
        <div className="flex items-center gap-1 text-[var(--color-text)]">
          <NavLink
            to="/"
            className="flex items-center gap-2 font-sans text-[14px] font-semibold"
          >
            <Icon name="logo" size={20} color="var(--color-accent)" strokeWidth={1.8} />
            <span>Conduit</span>
          </NavLink>
          <div
            aria-hidden
            className="mx-3 h-[18px] w-px bg-[var(--color-divider)]"
          />
          <NavIconLink to="/" end label="Home — all workflows" icon="home" />
          <NavIconLink to="/credentials" label="Settings" icon="settings" />
        </div>

        {/* Center — page-supplied tabs */}
        <div className="flex items-center justify-center">{centerSlot}</div>

        {/* Right — page-supplied actions, with global status fallback */}
        <div className="flex items-center justify-end">
          {actionsSlot ?? (
            <div className="pill">
              <span className="dot" />
              <span className="text-[var(--color-text-muted)]">services</span>
              <span className="text-[var(--color-text)]">healthy</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function NavIconLink({
  to,
  end,
  label,
  icon,
}: {
  to: string;
  end?: boolean;
  label: string;
  icon: 'home' | 'settings';
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        [
          'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius)] transition-colors',
          isActive
            ? 'bg-[var(--color-pill-bg)] text-[var(--color-text)]'
            : 'text-[var(--color-text-2)] hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)]',
        ].join(' ')
      }
    >
      <Icon name={icon} size={15} color="currentColor" />
    </NavLink>
  );
}
