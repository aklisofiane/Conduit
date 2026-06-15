import { buildTemporalSlug, type WorkflowDefinition } from '@conduit/shared';
import type { PrismaService } from '../common/prisma.service';

/**
 * Minimal workflow shape needed to resolve-and-freeze the Temporal slug.
 * Both `workflows.service` and `templates.service` already load these
 * scalars, so they pass the row straight in.
 */
export interface TemporalSlugWorkflow {
  id: string;
  name: string;
  definition: unknown;
  temporalSlug: string | null;
}

/**
 * Resolve the workflow's frozen Temporal slug, freezing it on first call.
 *
 * The slug is the cosmetic, human-readable prefix woven into every Temporal
 * id (schedule, poll/cron runs, agent runs). It is computed once — from the
 * workflow name + its source connection name — and persisted to
 * `Workflow.temporalSlug`. Subsequent calls return the stored value verbatim,
 * so a later rename/repoint never shifts the id (the immutable cuid stays the
 * sole determinism anchor).
 *
 *   - Already frozen (`temporalSlug` set)        → return it unchanged.
 *   - Source connection resolvable               → `<wf>-<conn>`, persisted.
 *   - No trigger / draft / deleted connection    → name only, persisted.
 *   - Name slugs to empty                        → `undefined`, NOT persisted
 *     (the workflow keeps producing slug-less ids until it has a usable name,
 *     at which point the next call freezes a real slug).
 *
 * Returns `undefined` (not `''`) for the no-slug case so callers can thread the
 * result straight into the id builders without an extra `|| undefined` coerce.
 *
 * Only ever called on the materialize (create/upsert/run-start) paths — never
 * on teardown. Schedule/run removal reads the already-frozen `temporalSlug`
 * directly, so it never freezes a fresh slug or targets the wrong id.
 *
 * The write is guarded on `temporalSlug: null` so a concurrent freeze can't
 * overwrite an existing value — and since the slug is deterministic, racing
 * writers compute the same string anyway.
 */
export async function resolveTemporalSlug(
  prisma: PrismaService,
  wf: TemporalSlugWorkflow,
): Promise<string | undefined> {
  if (wf.temporalSlug) return wf.temporalSlug;

  const trigger = (wf.definition as Partial<WorkflowDefinition> | null)?.triggers?.[0];
  const connectionId = trigger?.connectionId;
  let connectionName: string | undefined;
  if (connectionId) {
    const conn = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: { name: true },
    });
    connectionName = conn?.name ?? undefined;
  }

  const slug = buildTemporalSlug(wf.name, connectionName);
  if (!slug) return undefined;

  // First writer wins; the null guard keeps a frozen slug immutable even if
  // two starts race the freeze. `updateMany` (not `update`) so a row already
  // frozen by the winner is a silent no-op rather than a throw.
  await prisma.workflow.updateMany({
    where: { id: wf.id, temporalSlug: null },
    data: { temporalSlug: slug },
  });
  return slug;
}
