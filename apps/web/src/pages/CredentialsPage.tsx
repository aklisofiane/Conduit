import { useCredentials } from '../api/hooks.js';
import { relativeFromNow } from '../lib/time.js';

export function CredentialsPage() {
  const { data: credentials = [], isLoading } = useCredentials();

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 pb-16 pt-10">
      <h1
        className="text-[34px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        Settings<em className="text-[var(--color-claude)] not-italic">.</em>
      </h1>
      <p className="font-mono text-[12px] text-[var(--color-text-2)]">
        Credentials, connections, deployment. Single-tenant v1 — no users, no RBAC.
      </p>

      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-1)]">
        <header className="border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="font-mono text-[13px] font-semibold">Platform credentials</h2>
          <p className="mt-1 font-mono text-[11px] text-[var(--color-text-3)]">
            Encrypted at rest with AES-256-GCM. Referenced by workflow connections.
          </p>
        </header>
        <div>
          {isLoading && (
            <div className="flex h-16 items-center justify-center font-mono text-[12px] text-[var(--color-text-3)]">
              Loading…
            </div>
          )}
          {!isLoading && credentials.length === 0 && (
            <div className="flex h-24 items-center justify-center font-mono text-[12px] text-[var(--color-text-4)]">
              No credentials yet. POST /api/credentials to add one.
            </div>
          )}
          {credentials.map((cred) => (
            <div
              key={cred.id}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-[var(--color-line)] px-4 py-3 last:border-b-0"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] font-mono text-[10.5px]">
                {cred.platform.slice(0, 2)}
              </span>
              <div>
                <div className="font-mono text-[13px] font-medium">{cred.name}</div>
                <div className="font-mono text-[11px] text-[var(--color-text-3)]">
                  {cred.platform.toLowerCase()} · ••••{cred.suffix} · {cred.connectionCount} connection
                  {cred.connectionCount === 1 ? '' : 's'}
                </div>
              </div>
              <div className="font-mono text-[11px] text-[var(--color-text-3)]">
                rotated {relativeFromNow(cred.updatedAt)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
