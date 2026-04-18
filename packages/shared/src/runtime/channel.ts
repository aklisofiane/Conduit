import type { AgentEvent } from './event';

/**
 * Redis pub/sub channel for run-detail live updates. The worker publishes
 * here; the API's `/runs` Socket.IO gateway forwards to subscribed clients.
 * A typo in either side silently breaks the live pipeline — keep the
 * constant (and the message shape) here so both processes share it.
 */
export const RUN_UPDATES_CHANNEL = 'conduit:run-updates';

/**
 * Synthetic event emitted by the worker for things that aren't real
 * provider events (workspace setup, errors, lifecycle). Kept distinct from
 * `AgentEvent` so the discriminated union for live frames stays open.
 */
export interface SystemEvent {
  type: 'system';
  message: string;
}

export interface RunUpdateMessage {
  runId: string;
  nodeName: string;
  event: AgentEvent | SystemEvent;
  ts: string;
}
