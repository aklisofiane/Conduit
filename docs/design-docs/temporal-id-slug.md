# Human-readable Temporal IDs (frozen slug)

Every Temporal workflow-execution and schedule used to be keyed on an opaque cuid
(`poll-run-cmqc6hclk0001pk0120wulvnx`), so an operator scanning the Temporal UI
couldn't tell which Conduit workflow — or which repo — a row belonged to without
cross-referencing the DB. This subsystem weaves a **frozen, human-readable slug**
(`<workflow-name>-<connection-name>`) in front of every Temporal id as a *cosmetic
prefix*. The immutable cuid stays the suffix and remains the **sole determinism
anchor** — schedule identity, ticket-branch dedup, and overlap-SKIP all still rest
on it, untouched.

## ID shapes

```
  schedule        poll-<slug>-<cuid>
  poll run        poll-run-<slug>-<cuid>
  cron run        cron-run-<slug>-<cuid>
  agent run       run-<slug>-<runId>
  ticket-branch   run-<slug>-<workflowId>-<ticketKey>
```

When the slug is empty/omitted, every builder emits **today's slug-less id verbatim**
(`poll-<cuid>`, `run-<runId>`, …) — so an un-frozen workflow keeps matching its
existing schedule, and the rollout is a no-op except at the single freeze moment.

## Where the logic lives

The slug is built in two places because of the Temporal sandbox boundary:

- **`packages/shared/src/temporal/queue.ts`** runs inside the V8 sandbox — no Prisma,
  no DB. It owns the **pure** `buildTemporalSlug(workflowName, connectionName?)` (kebab-
  slugify each segment to `[a-z0-9-]`, cap at 20 chars, join `<wf>-<conn>`) and the four
  id builders (`workflowScheduleId`, `pollWorkflowId`, `cronWorkflowId`,
  `agentWorkflowId`), each gaining an optional trailing `slug?`.
- **`apps/api/src/temporal/temporal-slug.ts`** owns `resolveTemporalSlug` — the
  resolve-and-freeze step that needs Prisma: look up the trigger's source connection
  name, compose the slug, and persist it. Both `workflows.service` and `templates.service`
  call it so the logic isn't duplicated.

## Freeze-once semantics

The slug is computed **once**, the first time a workflow materializes a schedule or a
run, and stored on `Workflow.temporalSlug` (`null → value`). Every later call returns
the stored value verbatim — so a subsequent **rename or repoint never shifts the id**.
This is the deliberate trade: renames go stale in the Temporal UI in exchange for a
stable schedule identity. The write is guarded on `temporalSlug: null` (via `updateMany`,
not `update`) so a concurrent freeze can't clobber an existing value; since the slug is
deterministic, racing writers compute the same string anyway.

Fallbacks when resolving:

| Situation | Result |
|---|---|
| Already frozen (`temporalSlug` set) | return it unchanged |
| Source connection resolvable | `<wf>-<conn>`, persisted |
| No trigger / draft / deleted connection | name only, persisted |
| Workflow name slugs to empty | `''`, **not** persisted — stays slug-less until it has a usable name |

Source connection = the trigger's `connectionId` (not `boardConnectionId`). The composed
slug is never parsed back, so dashes inside a segment are harmless.

## One writer, many readers

The **API** is the only writer. By the time a **worker** activity builds an agent-run id,
the schedule already exists, so the slug is already frozen — `poll-board.ts` and
`cron-fire.ts` only **read** `wf.temporalSlug` (both already load the full workflow row).

> Workers must never recompute the slug from the live workflow name. A rename between
> freeze and read would diverge from the frozen value and break ticket-branch dedup
> against an in-flight run.

## One target id per workflow — no legacy migration

`Workflow.temporalSlug` is nullable, frozen on the first materialization of a schedule or
run. There is **no backfill and no legacy re-key path**: the namespace carries no pre-slug
`poll-<cuid>` schedules to migrate, so the slug a schedule is created under is the slug it
is torn down under.

The single rule that keeps create and teardown in agreement: **only the materialize paths
(`upsertWorkflowSchedule` via `syncWorkflowSchedule`, and `startRun`) ever call
`resolveTemporalSlug` (which freezes); every teardown path reads the already-frozen
`temporalSlug` directly.** Concretely:

- Removing a trigger → `syncWorkflowSchedule` deletes `workflowScheduleId(id, wf.temporalSlug)`.
- Hard delete → the API reads `temporalSlug` *before* `deleteMany`, then deletes the same id.

Because both teardown paths read the stored value, a never-frozen workflow (`temporalSlug =
null`) resolves to the slug-less id — exactly what its schedule was created under — and a
frozen one resolves to its slugged id. Neither path re-resolves, so neither can target a
mismatched id and leak the real schedule. Historical `WorkflowRun.temporalWorkflowId` values
are untouched, and cancellation uses the stored full id, so in-flight runs are unaffected.

## See also

- [agent-execution.md](./agent-execution.md#polling-pipeline) — the schedule/poll/cron lifecycle the slug threads through
- [branch-management.md](./branch-management.md#concurrency) — ticket-branch dedup, which still keys on the cuid suffix
- [data-model.md](../data-model.md) — the `Workflow.temporalSlug` column
