import { z } from 'zod';

/**
 * Run lifecycle states — mirrors the Prisma enum. Used by both `WorkflowRun`
 * and `NodeRun`.
 *
 * WorkflowRun: PENDING (row created) → RUNNING (Temporal started) → COMPLETED | FAILED | CANCELLED.
 * NodeRun:     PENDING (graph loaded) → RUNNING (activity started) → COMPLETED | FAILED | CANCELLED.
 */
export const runStatusSchema = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);
export type RunStatus = z.infer<typeof runStatusSchema>;

/**
 * States a run can never leave. Single source of truth for the orphan
 * sweeps (docker-admin / process-admin): a runner whose run is terminal
 * has nothing left to do and is safe to reap.
 */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export const nodeTypeSchema = z.enum(['TRIGGER', 'AGENT']);
export type NodeType = z.infer<typeof nodeTypeSchema>;

export const logLevelSchema = z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const executionLogKindSchema = z.enum([
  'TEXT',
  'TOOL_CALL',
  'TOOL_RESULT',
  'USAGE',
  'SYSTEM',
]);
export type ExecutionLogKind = z.infer<typeof executionLogKindSchema>;
