import type { ReactNode } from 'react';

/**
 * Shared shell for the settings sections (API keys, credentials, connections):
 * the bordered `<section>`, the title/description `<header>`, and the
 * "+ New / Cancel" create toggle. Each section supplies its own create-form and
 * row list as `children` — the markup of those parts varies per section, but the
 * outer scaffolding is identical.
 */
export function SettingsSection({
  title,
  description,
  creating,
  onToggleCreate,
  children,
}: {
  title: string;
  description: ReactNode;
  creating: boolean;
  onToggleCreate: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-mono text-[13px] font-semibold">{title}</h2>
          <p className="font-mono text-[11px] text-[var(--color-text-3)]">{description}</p>
        </div>
        <button className="btn shrink-0 whitespace-nowrap" onClick={onToggleCreate}>
          {creating ? 'Cancel' : '+ New'}
        </button>
      </header>

      {children}
    </section>
  );
}
