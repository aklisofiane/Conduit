import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/cn.js';

const navItems = [
  { to: '/', label: 'home', end: true },
  { to: '/credentials', label: 'settings' },
];

export function TopChrome() {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[rgba(9,9,11,0.85)] backdrop-blur">
      <div className="flex h-12 items-center gap-6 px-5">
        <NavLink to="/" className="flex items-center gap-2 font-mono text-[13px] font-semibold">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" strokeWidth="1.8">
            <path d="M3 6c4 0 6 4 9 4s5-4 9-4" stroke="#f5a623" strokeLinecap="round" />
            <path d="M3 12c4 0 6 4 9 4s5-4 9-4" stroke="#e4e4e7" strokeLinecap="round" />
            <path d="M3 18c4 0 6 4 9 4s5-4 9-4" stroke="#14b8a6" strokeLinecap="round" />
          </svg>
          <span>
            conduit<em className="text-[var(--color-text-3)] not-italic">/</em>
          </span>
        </NavLink>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 font-mono text-[11.5px] lowercase transition-colors',
                  isActive
                    ? 'bg-[var(--color-bg-2)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-3)] hover:text-[var(--color-text)]',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="pill">
          <span className="dot" />
          <span>services</span>
          <span className="text-[var(--color-text-3)]">·</span>
          <span className="text-[var(--color-text)]">healthy</span>
        </div>
      </div>
    </header>
  );
}
