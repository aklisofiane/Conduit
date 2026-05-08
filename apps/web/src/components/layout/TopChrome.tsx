import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/cn.js';
import { Icon } from '../canvas/Icon.js';
import { useTopbarSlotsStore } from '../../state/topbar-slots.js';
import { UserMenuPill } from './UserMenuPill.js';

export function TopChrome() {
  const centerSlot = useTopbarSlotsStore((s) => s.centerSlot);
  const actionsSlot = useTopbarSlotsStore((s) => s.actionsSlot);

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-divider)] bg-[var(--color-bg-panel)]">
      <div
        className="grid h-12 items-center gap-4 px-4"
        style={{ gridTemplateColumns: '1fr auto 1fr' }}
      >
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

        <div className="flex items-center justify-center">{centerSlot}</div>

        <div className="flex items-center justify-end">{actionsSlot ?? <UserMenuPill />}</div>
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
        cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius)] transition-colors',
          isActive
            ? 'bg-[var(--color-pill-bg)] text-[var(--color-text)]'
            : 'text-[var(--color-text-2)] hover:bg-[var(--color-pill-bg)] hover:text-[var(--color-text)]',
        )
      }
    >
      <Icon name={icon} size={15} color="currentColor" />
    </NavLink>
  );
}
