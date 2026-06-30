import { NavLink } from 'react-router-dom';
import { Home, Settings, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Logo } from '../common/BrandGlyph.js';
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
            className="flex items-center gap-2 font-sans text-base font-semibold"
          >
            <Logo size={20} color="var(--color-accent)" />
            <span>Conduit</span>
          </NavLink>
          <div
            aria-hidden
            className="mx-3 h-[18px] w-px bg-[var(--color-divider)]"
          />
          <NavIconLink to="/" end label="Home — all workflows" icon={Home} />
          <NavIconLink to="/settings" label="Settings" icon={Settings} />
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
  icon: IconComponent,
}: {
  to: string;
  end?: boolean;
  label: string;
  icon: LucideIcon;
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
      <IconComponent size={15} strokeWidth={1.5} />
    </NavLink>
  );
}
