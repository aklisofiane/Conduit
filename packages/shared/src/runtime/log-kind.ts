import type { AgentEvent } from './event';
import type { ExecutionLogKind } from '../workflow/enums';

/**
 * Map an `AgentEvent` discriminator onto the `ExecutionLogKind` used for
 * persistence and rendering. Lives in shared so the worker (which writes
 * the logs) and the web (which optimistically appends live frames into the
 * same cache) stay in sync as new event types are added.
 */
const KIND_BY_EVENT_TYPE: Record<AgentEvent['type'], ExecutionLogKind> = {
  text: 'TEXT',
  tool_call: 'TOOL_CALL',
  tool_result: 'TOOL_RESULT',
  usage: 'USAGE',
  done: 'SYSTEM',
};

export function agentEventToLogKind(eventType: AgentEvent['type']): ExecutionLogKind {
  return KIND_BY_EVENT_TYPE[eventType];
}
