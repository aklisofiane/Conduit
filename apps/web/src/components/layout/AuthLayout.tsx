import { Outlet } from 'react-router-dom';
import { Logo } from '../common/BrandGlyph.js';

/**
 * Unauthenticated shell for `/sign-in`, `/sign-up`, `/forgot-password`,
 * `/reset-password`. No `TopChrome`; the page renders centered inside a
 * card surface with the brand mark above. Pages provide their own heading
 * and form via `<Outlet />`.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-bg)] px-4 py-10">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-6">
        <div className="flex items-center gap-2 text-[var(--color-text)]">
          <Logo size={22} color="var(--color-accent)" strokeWidth={1.8} />
          <span className="font-sans text-[15px] font-semibold tracking-tight">Conduit</span>
        </div>
        <div className="w-full rounded-[var(--radius-lg)] border border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-7 py-8 shadow-[0_1px_0_rgba(11,16,32,0.02)]">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
