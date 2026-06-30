import type { ReactNode } from 'react';
import { Button } from '../ui/button.js';

/**
 * Shared shell for the settings sections (API keys, credentials, connections):
 * the bordered `<section>`, the title/description `<header>`, and the
 * "+ New / Cancel" create toggle. Each section supplies its own create-form and
 * row list as `children` — the markup of those parts varies per section, but the
 * outer scaffolding is identical.
 *
 * Omit `onToggleCreate` for sections with a fixed row set (e.g. model pricing,
 * one row per known model) — the create toggle is then hidden.
 */
export function SettingsSection({
  title,
  description,
  creating = false,
  onToggleCreate,
  children,
}: {
  title: string;
  description: ReactNode;
  creating?: boolean;
  onToggleCreate?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-divider)] bg-[var(--color-bg-panel)]">
      <header className="flex items-center justify-between border-b border-[var(--color-divider)] px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-mono text-base font-semibold">{title}</h2>
          <p className="font-mono text-small text-[var(--color-text-muted)]">{description}</p>
        </div>
        {onToggleCreate && (
          <Button className="shrink-0 whitespace-nowrap" onClick={onToggleCreate}>
            {creating ? 'Cancel' : '+ New'}
          </Button>
        )}
      </header>

      {children}
    </section>
  );
}
