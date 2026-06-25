import { useMemo, useState } from 'react';
import { CONDUIT_LABELS } from '@conduit/shared/label';
import { isCloudHost } from '@conduit/shared/platform';
import type { Platform } from '@conduit/shared/platform';
import { ApiError, apiErrorMessage } from '../../api/client.js';
import {
  useConnections,
  useCreateConnection,
  useCredentials,
  useDeleteConnection,
  useEnsureRepoLabels,
} from '../../api/hooks.js';
import type { ConnectionRow } from '../../api/types.js';
import {
  ensureLabelTarget,
  scopeSummary,
  type EnsureLabelTarget,
} from '../../lib/connection.js';
import { SettingsSection } from '../common/SettingsSection.js';
import { CreateConnectionForm } from './ConnectionForm.js';

/**
 * Connections are global, not per-workflow: a workflow's trigger and MCP slots
 * reference a connection id, and the same connection can back many workflows.
 */
export function ConnectionsSection() {
  const { data: connections = [], isLoading } = useConnections();
  const { data: credentials = [] } = useCredentials();
  const create = useCreateConnection();
  const del = useDeleteConnection();

  const [creating, setCreating] = useState(false);
  // After a repo/project connection is created, offer to add Conduit's labels
  // to it so label-gated templates work without hand-creating labels.
  const [labelPrompt, setLabelPrompt] = useState<EnsureLabelTarget | null>(null);

  return (
    <SettingsSection
      title="Connections"
      description="A connection picks a credential and pins it to a scope (a repo, a project board). Workflows reference connections directly."
      creating={creating}
      onToggleCreate={() => setCreating((v) => !v)}
    >
      {creating && (
        <CreateConnectionForm
          credentials={credentials}
          pending={create.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={async (body) => {
            try {
              const conn = await create.mutateAsync(body);
              setCreating(false);
              setLabelPrompt(ensureLabelTarget([conn], conn.id) ?? null);
            } catch (e) {
              alert(apiErrorMessage(e));
            }
          }}
        />
      )}

      {labelPrompt && (
        <LabelPrompt
          target={labelPrompt}
          onDismiss={() => setLabelPrompt(null)}
        />
      )}

      {isLoading && (
        <div className="flex h-16 items-center justify-center font-mono text-[12px] text-[var(--color-text-3)]">
          Loading…
        </div>
      )}
      {!isLoading && connections.length === 0 && !creating && (
        <div className="flex h-24 items-center justify-center font-mono text-[12px] text-[var(--color-text-4)]">
          No connections yet.
        </div>
      )}
      {connections.map((conn) => (
        <ConnectionRowView
          key={conn.id}
          conn={conn}
          onDelete={async () => {
            if (!confirm(`Delete connection "${conn.name}"?`)) return;
            try {
              await del.mutateAsync(conn.id);
            } catch (e) {
              alert(e instanceof ApiError ? e.message : String(e));
            }
          }}
        />
      ))}
    </SettingsSection>
  );
}

/**
 * Post-create prompt offering to add Conduit's four workflow labels to a
 * freshly-created repo/project connection. Pre-checked checkboxes; Add calls
 * the ensure endpoint and reports per-label outcome; Skip dismisses with no
 * calls. `conduit-human-review` is included even though it's never a trigger
 * value — it's a writeback target that must exist on the repo/project.
 */
function LabelPrompt({
  target,
  onDismiss,
}: {
  target: EnsureLabelTarget;
  onDismiss: () => void;
}) {
  const ensure = useEnsureRepoLabels();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(CONDUIT_LABELS.map((l) => l.name)),
  );

  const resultByName = useMemo(
    () => new Map((ensure.data ?? []).map((r) => [r.name, r] as const)),
    [ensure.data],
  );
  // A 200 still carries per-label failures (e.g. a read-only token), so HTTP
  // success isn't terminal — only treat it as done when nothing failed.
  // Otherwise the prompt stays interactive so the failing labels can be retried.
  const hasFailures = (ensure.data ?? []).some((r) => r.status === 'failed');
  const done = ensure.isSuccess && !hasFailures;

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const add = () => {
    const names = [...selected];
    if (names.length > 0) ensure.mutate({ connectionId: target.connectionId, names });
  };

  const topLevelError = ensure.error ? apiErrorMessage(ensure.error) : null;

  return (
    <div className="border-b border-[var(--color-line)] px-4 py-4">
      <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2,var(--color-bg-1))] p-3">
        <div className="font-mono text-[12px]">
          Connected{' '}
          <code className="text-[var(--color-text)]">{target.scopeLabel}</code>{' '}
          ✓
        </div>
        <div className="font-mono text-[11px] text-[var(--color-text-3)]">
          Add Conduit's workflow labels to this repo/project?
        </div>

        <div className="flex flex-col gap-1.5">
          {CONDUIT_LABELS.map((l) => {
            const r = resultByName.get(l.name);
            return (
              <label
                key={l.name}
                className="flex items-center gap-2 font-mono text-[12px]"
              >
                <input
                  type="checkbox"
                  checked={selected.has(l.name)}
                  disabled={ensure.isPending || done}
                  onChange={() => toggle(l.name)}
                />
                <code className="text-[var(--color-text)]">{l.name}</code>
                {r &&
                  (r.status === 'failed' ? (
                    <span className="text-[var(--color-danger,#dc322f)]">
                      ✗ {r.error ?? 'failed'}
                    </span>
                  ) : (
                    <span className="text-[var(--color-success,#2da44e)]">
                      ✓ {r.status}
                    </span>
                  ))}
              </label>
            );
          })}
        </div>

        {topLevelError && (
          <div className="font-mono text-[11px] text-[var(--color-danger,#dc322f)]">
            {topLevelError}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {done ? (
            <button className="btn" onClick={onDismiss}>
              Done
            </button>
          ) : (
            <>
              <button className="btn" onClick={onDismiss}>
                Skip
              </button>
              <button
                className="btn"
                disabled={ensure.isPending || selected.size === 0}
                onClick={add}
              >
                {ensure.isPending
                  ? 'Adding…'
                  : hasFailures
                    ? 'Retry'
                    : 'Add labels'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectionRowView({ conn, onDelete }: { conn: ConnectionRow; onDelete: () => void }) {
  const summary = scopeSummary(conn.scope);
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-[var(--color-line)] px-4 py-3 last:border-b-0">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] font-mono text-[10.5px]">
        {conn.credential.platform.slice(0, 2)}
      </span>
      <div>
        <div className="font-mono text-[13px] font-medium">{conn.name}</div>
        <div className="font-mono text-[11px] text-[var(--color-text-3)]">
          {conn.credential.name} · {conn.credential.platform.toLowerCase()}
          {conn.credential.hostUrl &&
            !isCloudHost(conn.credential.platform as Platform, conn.credential.hostUrl) &&
            ` · ${conn.credential.hostUrl}`}
          {summary && ` · ${summary}`}
        </div>
      </div>
      <button className="btn" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
