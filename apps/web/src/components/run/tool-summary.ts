/**
 * One-line summary + ok/error status for a tool call/result pair, used by
 * the collapsed timeline rows. Intentionally non-exhaustive: a small switch
 * over the tools we see often, with a generic JSON-stringify fallback so
 * unknown tools still render something readable.
 */

export type ToolStatus = 'ok' | 'error' | 'pending';

export interface ToolSummary {
  summary: string;
  status: ToolStatus;
}

interface ToolCallPayload {
  id?: string;
  name?: string;
  input?: unknown;
}

interface ToolResultPayload {
  id?: string;
  output?: unknown;
  error?: string;
}

const STATUS_PENDING: ToolStatus = 'pending';

export function summarizeToolCall(
  call: ToolCallPayload,
  result: ToolResultPayload | undefined,
): ToolSummary {
  const name = call.name ?? '';
  const input = (call.input ?? {}) as Record<string, unknown>;
  const status: ToolStatus =
    result === undefined ? STATUS_PENDING : result.error ? 'error' : 'ok';

  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return { summary: tail(stringField(input.file_path), 60), status };
    case 'Bash':
      return { summary: oneLine(stringField(input.command), 80), status };
    case 'Grep':
      return {
        summary: `${stringField(input.pattern) || '(empty)'} in ${stringField(input.path) || '.'}`,
        status,
      };
    case 'Glob':
      return { summary: stringField(input.pattern) || '(empty)', status };
    case 'Skill':
      return { summary: stringField(input.skill) || '(empty)', status };
    case 'Agent':
      return {
        summary: stringField(input.subagent_type) || stringField(input.description) || '(agent)',
        status,
      };
    case 'ToolSearch':
      return { summary: truncate(stringField(input.query), 60), status };
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos.length : 0;
      return { summary: `${todos} todo${todos === 1 ? '' : 's'}`, status };
    }
    case 'WebFetch':
    case 'WebSearch':
      return {
        summary: stringField(input.url) || stringField(input.query) || '(empty)',
        status,
      };
    default:
      return { summary: summarizeUnknown(name, input), status };
  }
}

function summarizeUnknown(name: string, input: Record<string, unknown>): string {
  // MCP tools follow `mcp__<server>__<tool>` — surface the tail and any
  // obvious identifying fields. Plain JSON dump for everything else.
  if (name.startsWith('mcp__')) {
    const ident = pickIdentifyingFields(input);
    return ident ? ident : '(no args)';
  }
  let s: string;
  try {
    s = JSON.stringify(input);
  } catch {
    s = String(input);
  }
  return truncate(s, 60);
}

const IDENT_KEYS = [
  'owner',
  'repo',
  'issue_number',
  'pull_number',
  'branch',
  'ref',
  'path',
  'name',
  'id',
  'query',
  'channel',
];

function pickIdentifyingFields(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof input.owner === 'string' && typeof input.repo === 'string') {
    parts.push(`${input.owner}/${input.repo}`);
  }
  for (const key of IDENT_KEYS) {
    if (key === 'owner' || key === 'repo') continue;
    const v = input[key];
    if (typeof v === 'string' && v) parts.push(`${key}=${truncate(v, 30)}`);
    else if (typeof v === 'number') parts.push(`${key}=${v}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}

export function prettyToolName(name: string): string {
  // Drop the `mcp__<server>__` prefix for MCP tools so the row reads as the
  // remote tool name, which is what the user actually configured.
  const m = name.match(/^mcp__[^_]+__(.+)$/);
  return m ? m[1]! : name;
}

function stringField(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function tail(s: string, n: number): string {
  return s.length > n ? `…${s.slice(s.length - n + 1)}` : s;
}

function oneLine(s: string, n: number): string {
  return truncate(s.replace(/\s+/g, ' ').trim(), n);
}
