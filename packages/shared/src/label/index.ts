/**
 * Canonical registry of Conduit's own `conduit-*` labels — the single source
 * of truth the *app* uses to know "which labels are ours".
 *
 * Template JSON keeps its own literal label strings (templates are standalone,
 * version-controlled artifacts, not refactored to import code); this registry
 * is what the UI affordances and the ensure endpoint read to create the labels
 * on a repo/project and to recognise an unmatched value as a known Conduit
 * label.
 *
 * Platform-neutral: the same labels apply on GitHub and GitLab. `color` is a
 * 6-digit hex *without* a leading `#` (GitHub's native form; the GitLab create
 * client prepends `#`).
 */

export interface ConduitLabel {
  name: string;
  /** 6-digit hex, no leading `#`. */
  color: string;
  description: string;
}

/**
 * Four labels:
 *  - three AI-handoff trigger gates (`conduit-dev`, `conduit-review`,
 *    `conduit-merge`)
 *  - one human-park writeback target (`conduit-human-review`) — never a trigger
 *    value, but it must exist on the repo/project for an agent's end-of-run
 *    label application to land.
 */
export const CONDUIT_LABELS: readonly ConduitLabel[] = [
  {
    name: 'conduit-dev',
    color: '1f6feb',
    description: 'Conduit: hand off to the Develop workflow',
  },
  {
    name: 'conduit-review',
    color: '8957e5',
    description: 'Conduit: hand off to the Review workflow',
  },
  {
    name: 'conduit-merge',
    color: '2da44e',
    description: 'Conduit: hand off to the Merge workflow',
  },
  {
    name: 'conduit-human-review',
    color: 'd29922',
    description: 'Conduit: parked for human review',
  },
] as const;

/** The registry entry for `name`, or `undefined` if it isn't a Conduit label. */
export function getConduitLabel(name: string): ConduitLabel | undefined {
  return CONDUIT_LABELS.find((l) => l.name === name);
}

/** True when `name` is one of Conduit's canonical labels (exact match). */
export function isConduitLabel(name: string): boolean {
  return !!getConduitLabel(name);
}

/**
 * Per-label outcome of an ensure-labels call (one entry per requested name).
 * Shared so the API service and the web hook describe the
 * `POST /trigger/ensure-labels` response with one contract.
 */
export interface EnsureLabelResult {
  name: string;
  status: 'created' | 'exists' | 'failed';
  error?: string;
}
