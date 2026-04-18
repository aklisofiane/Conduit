import type { RunStatus } from '@conduit/shared';

/**
 * Map run / node lifecycle status onto the CSS class used by the dot,
 * pill, and rail-item visuals defined in `styles/globals.css`. Both the
 * workflow list and the run detail page reach for this — keep it shared.
 */
export function statusClass(status: RunStatus | string | undefined): string {
  switch (status) {
    case 'COMPLETED':
      return 'ok';
    case 'RUNNING':
      return 'running';
    case 'FAILED':
      return 'error';
    case 'CANCELLED':
      return 'paused';
    default:
      return 'pending';
  }
}
