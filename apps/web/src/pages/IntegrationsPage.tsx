import { ConnectionsSection } from '../components/settings/ConnectionsSection.js';
import { CredentialsSection } from '../components/settings/CredentialsSection.js';

/**
 * `/settings/integrations` — credentials + connections on one surface. The
 * two are coupled (a credential can back many connections; deleting a
 * credential is blocked while connections reference it), so they live
 * together rather than as separate sidebar entries.
 */
export function IntegrationsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 pb-16 pt-10">
      <h1
        className="text-display font-semibold leading-none tracking-tight text-[var(--color-text)]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        Integrations
      </h1>
      <p className="font-mono text-small text-[var(--color-text-2)]">
        Platform credentials and the connections built on top of them. Workflows reference connections directly.
      </p>

      <CredentialsSection />
      <ConnectionsSection />
    </div>
  );
}
