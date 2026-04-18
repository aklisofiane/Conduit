import { agentEventToLogKind, type AgentEvent } from '@conduit/shared';
import { prisma } from './prisma';

/**
 * Append one `ExecutionLog` row per `AgentEvent`. Called from inside
 * `runAgentNode` alongside the live publish — durability + replay on one
 * side, live UI on the other.
 */
export async function writeAgentEventLog(
  runId: string,
  nodeName: string,
  event: AgentEvent,
): Promise<void> {
  await prisma().executionLog.create({
    data: {
      runId,
      nodeName,
      kind: agentEventToLogKind(event.type),
      payload: event as unknown as object,
    },
  });
}

export async function writeSystemLog(
  runId: string,
  nodeName: string | null,
  message: string,
  level: 'INFO' | 'WARN' | 'ERROR' = 'INFO',
): Promise<void> {
  await prisma().executionLog.create({
    data: {
      runId,
      nodeName,
      level,
      kind: 'SYSTEM',
      payload: { message } as unknown as object,
    },
  });
}
