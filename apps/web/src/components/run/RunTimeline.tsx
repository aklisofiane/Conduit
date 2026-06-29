import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, ExecutionLogRow } from '../../api/types.js';
import { cn } from '../../lib/cn.js';
import { DisclosureButton } from '../ui/disclosure.js';
import { prettyToolName, summarizeToolCall, type ToolStatus } from './tool-summary.js';

interface RunTimelineProps {
  events: ExecutionLogRow[];
  streaming: boolean;
}

type ToolCallPayload = Extract<AgentEvent, { type: 'tool_call' }>;
type ToolResultPayload = Extract<AgentEvent, { type: 'tool_result' }>;

interface ToolItem {
  id: string;
  tsMs: number;
  call: ToolCallPayload;
  result?: ToolResultPayload;
  summary: string;
  status: ToolStatus;
}

type DisplayItem =
  | { kind: 'text'; id: string; tsMs: number; nodeName: string; delta: string }
  | { kind: 'system'; id: string; tsMs: number; nodeName: string; message: string }
  | { kind: 'tool'; id: string; tsMs: number; tool: ToolItem }
  | {
      kind: 'tool-group';
      id: string;
      tsMs: number;
      toolName: string;
      tools: ToolItem[];
      status: ToolStatus;
      statusLabel: string;
    };

export function RunTimeline({ events, streaming }: RunTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const display = useMemo(() => buildDisplay(events), [events]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!streaming) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [events, streaming]);

  if (display.length === 0) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-[var(--color-text-muted)]">
        No events yet — waiting for the agent to start.
      </div>
    );
  }

  const startMs = display[0]!.tsMs;
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-6 py-5">
      <div className="space-y-2">
        {display.map((item, idx) => {
          const last = streaming && idx === display.length - 1;
          const offset = secondsSince(item.tsMs, startMs);
          switch (item.kind) {
            case 'text':
              return <TextRow key={item.id} item={item} offset={offset} cursor={last} />;
            case 'system':
              return <SystemRow key={item.id} item={item} offset={offset} />;
            case 'tool':
              return (
                <div
                  key={item.id}
                  className="overflow-hidden rounded-md border border-[var(--color-divider)] bg-[var(--color-bg-panel)]"
                >
                  <ExpandableTool
                    tool={item.tool}
                    offset={offset}
                    open={expanded.has(item.id)}
                    onToggle={() => toggle(item.id)}
                    cursor={last}
                  />
                </div>
              );
            case 'tool-group':
              return (
                <ToolGroupRow
                  key={item.id}
                  item={item}
                  startMs={startMs}
                  groupOpen={expanded.has(item.id)}
                  expanded={expanded}
                  onToggle={toggle}
                  cursor={last}
                />
              );
          }
        })}
      </div>
    </div>
  );
}

function buildDisplay(events: ExecutionLogRow[]): DisplayItem[] {
  return collapseToolGroups(flattenEvents(events));
}

/**
 * Flatten the raw event log into display items: drop bookkeeping frames
 * (usage/done/tool_result), merge consecutive same-node text deltas, and pair
 * each tool call with its result.
 */
function flattenEvents(events: ExecutionLogRow[]): DisplayItem[] {
  // Index tool_results by id up front so out-of-order frames still pair.
  const resultsById = new Map<string, ToolResultPayload>();
  for (const ev of events) {
    const p = asAgent(ev);
    if (p?.type === 'tool_result') resultsById.set(p.id, p);
  }

  const flat: DisplayItem[] = [];
  for (const ev of events) {
    if (ev.kind === 'USAGE') continue;
    const p = asAgent(ev);
    if (p?.type === 'usage' || p?.type === 'tool_result' || p?.type === 'done') continue;

    const tsMs = new Date(ev.ts).getTime();

    if (p?.type === 'text') {
      const prev = flat[flat.length - 1];
      if (prev?.kind === 'text' && prev.nodeName === ev.nodeName) {
        flat[flat.length - 1] = { ...prev, delta: prev.delta + p.delta };
      } else {
        flat.push({
          kind: 'text',
          id: ev.id,
          tsMs,
          nodeName: ev.nodeName ?? '',
          delta: p.delta,
        });
      }
      continue;
    }

    if (p?.type === 'tool_call') {
      const result = resultsById.get(p.id);
      const { summary, status } = summarizeToolCall(p, result);
      flat.push({
        kind: 'tool',
        id: ev.id,
        tsMs,
        tool: { id: ev.id, tsMs, call: p, result, summary, status },
      });
      continue;
    }

    const sys = ev.payload as { message?: unknown } | null;
    const msg =
      typeof sys?.message === 'string' ? sys.message : JSON.stringify(ev.payload, null, 2);
    flat.push({
      kind: 'system',
      id: ev.id,
      tsMs,
      nodeName: ev.nodeName ?? '',
      message: msg,
    });
  }

  return flat;
}

/** Collapse runs of ≥ 2 consecutive same-tool items into a tool-group. */
function collapseToolGroups(flat: DisplayItem[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let i = 0;
  while (i < flat.length) {
    const item = flat[i]!;
    if (item.kind !== 'tool') {
      out.push(item);
      i++;
      continue;
    }
    const toolName = item.tool.call.name;
    const tools: ToolItem[] = [item.tool];
    let j = i + 1;
    while (j < flat.length) {
      const next = flat[j];
      if (next?.kind !== 'tool' || next.tool.call.name !== toolName) break;
      tools.push(next.tool);
      j++;
    }
    if (tools.length >= 2) {
      const status = aggregateStatus(tools);
      out.push({
        kind: 'tool-group',
        id: `${item.id}+grp`,
        tsMs: item.tsMs,
        toolName,
        tools,
        status,
        statusLabel: aggregateLabel(status, tools),
      });
    } else {
      out.push(item);
    }
    i = j;
  }
  return out;
}

function asAgent(ev: ExecutionLogRow): AgentEvent | null {
  const p = ev.payload as { type?: unknown } | null;
  switch (p?.type) {
    case 'text':
    case 'tool_call':
    case 'tool_result':
    case 'usage':
    case 'done':
      return p as AgentEvent;
    default:
      return null;
  }
}

function aggregateStatus(tools: ToolItem[]): ToolStatus {
  let pending = false;
  let errors = 0;
  for (const t of tools) {
    if (t.status === 'pending') pending = true;
    else if (t.status === 'error') errors++;
  }
  if (pending) return 'pending';
  if (errors > 0) return 'error';
  return 'ok';
}

function aggregateLabel(status: ToolStatus, tools: ToolItem[]): string {
  if (status === 'pending') return 'running';
  if (status === 'error') {
    const errs = tools.filter((t) => t.status === 'error').length;
    return `${errs} error${errs === 1 ? '' : 's'}`;
  }
  return 'all ok';
}

function TextRow({
  item,
  offset,
  cursor,
}: {
  item: Extract<DisplayItem, { kind: 'text' }>;
  offset: string;
  cursor: boolean;
}) {
  return (
    <div className="rounded-md border border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-3 py-2.5">
      <div className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
        +{offset}s · text
      </div>
      <div className="mt-1 whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-[var(--color-text)]">
        {item.delta}
        {cursor && <span className="cursor" />}
      </div>
    </div>
  );
}

function SystemRow({
  item,
  offset,
}: {
  item: Extract<DisplayItem, { kind: 'system' }>;
  offset: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-3 py-2">
      <div className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-muted)]">
        +{offset}s · system
      </div>
      <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-[var(--color-text-2)]">
        {item.message}
      </pre>
    </div>
  );
}

function ExpandableTool({
  tool,
  offset,
  open,
  onToggle,
  cursor,
  nested = false,
}: {
  tool: ToolItem;
  offset: string;
  open: boolean;
  onToggle: () => void;
  cursor: boolean;
  nested?: boolean;
}) {
  return (
    <>
      <CollapsedToolHeader
        tool={tool}
        offset={offset}
        open={open}
        onToggle={onToggle}
        cursor={cursor}
        nested={nested}
      />
      {open && <ExpandedToolBody tool={tool} />}
    </>
  );
}

function ToolGroupRow({
  item,
  startMs,
  groupOpen,
  expanded,
  onToggle,
  cursor,
}: {
  item: Extract<DisplayItem, { kind: 'tool-group' }>;
  startMs: number;
  groupOpen: boolean;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  cursor: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-[var(--color-divider)] bg-[var(--color-bg-panel)]">
      <DisclosureButton
        size="sm"
        open={groupOpen}
        onClick={() => onToggle(item.id)}
        aria-label={`${groupOpen ? 'Collapse' : 'Expand'} ${item.tools.length} ${prettyToolName(item.toolName)} calls`}
        className="font-mono text-[11px] text-[var(--color-text-muted)]"
      >
        <span className="w-12 shrink-0 text-[var(--color-text-muted)]">
          +{secondsSince(item.tsMs, startMs)}s
        </span>
        <span className="shrink-0 text-[var(--color-claude-mark)] group-hover:text-[var(--color-text)]">
          {prettyToolName(item.toolName)}
        </span>
        <span className="shrink-0 text-[var(--color-text-muted)]">× {item.tools.length}</span>
        <span className="flex-1" />
        <StatusPill status={item.status} label={item.statusLabel} />
        {cursor && !groupOpen && <span className="cursor" />}
      </DisclosureButton>
      {groupOpen && (
        <div>
          {item.tools.map((tool, idx) => (
            <div key={tool.id} className="border-t border-[var(--color-divider)]">
              <ExpandableTool
                tool={tool}
                offset={secondsSince(tool.tsMs, startMs)}
                open={expanded.has(tool.id)}
                onToggle={() => onToggle(tool.id)}
                cursor={cursor && idx === item.tools.length - 1}
                nested
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CollapsedToolHeader({
  tool,
  offset,
  open,
  onToggle,
  cursor,
  nested,
}: {
  tool: ToolItem;
  offset: string;
  open: boolean;
  onToggle: () => void;
  cursor: boolean;
  nested: boolean;
}) {
  return (
    <DisclosureButton
      size="sm"
      open={open}
      onClick={onToggle}
      className={cn('font-mono text-[11.5px]', nested && 'pl-8')}
    >
      <span className="w-12 shrink-0 text-[var(--color-text-muted)]">+{offset}s</span>
      {!nested && (
        <span className="shrink-0 text-[var(--color-claude-mark)]">
          {prettyToolName(tool.call.name)}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]">
        {tool.summary}
      </span>
      <StatusPill status={tool.status} />
      {cursor && <span className="cursor" />}
    </DisclosureButton>
  );
}

function ExpandedToolBody({ tool }: { tool: ToolItem }) {
  const error = tool.result?.error;
  return (
    <div className="space-y-2 border-t border-[var(--color-divider)] bg-[var(--color-bg)] px-3 py-2">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          input
        </div>
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-[var(--color-text-2)]">
          {formatValue(tool.call.input)}
        </pre>
      </div>
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          {error ? 'error' : 'result'}
        </div>
        <pre
          className={cn(
            'mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px]',
            error ? 'text-[var(--color-error)]' : 'text-[var(--color-text-2)]',
          )}
        >
          {tool.result === undefined ? '(streaming…)' : (error ?? formatValue(tool.result.output))}
        </pre>
      </div>
    </div>
  );
}

function StatusPill({ status, label }: { status: ToolStatus; label?: string }) {
  const text = label ?? defaultStatusLabel(status);
  return (
    <span
      className={cn(
        'shrink-0 font-mono text-[10.5px]',
        status === 'error' && 'text-[var(--color-error)]',
        status === 'ok' && 'text-[var(--color-text-muted)]',
        status === 'pending' && 'italic text-[var(--color-text-muted)]',
      )}
    >
      {text}
    </span>
  );
}

function defaultStatusLabel(status: ToolStatus): string {
  if (status === 'pending') return '…';
  if (status === 'error') return 'error';
  return 'ok';
}

function secondsSince(tsMs: number, startMs: number): string {
  return ((tsMs - startMs) / 1000).toFixed(1);
}

/**
 * Render a tool's input/output for the expanded panel. Strings come through
 * raw so embedded newlines show as newlines (not `\n`). Objects/arrays are
 * rendered in a YAML-like form where multi-line string values are unfolded
 * under a `|` indicator — far more readable than `JSON.stringify(v, null, 2)`
 * for things like agent prompts and sub-agent results.
 */
function formatValue(v: unknown): string {
  if (v === undefined) return '(empty)';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return formatStructured(v, 0);
  } catch {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
}

function formatStructured(v: unknown, indent: number): string {
  const pad = '  '.repeat(indent);

  if (v === null) return 'null';
  if (v === undefined) return '(empty)';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);

  if (typeof v === 'string') {
    if (!v.includes('\n')) return v;
    const body = v
      .split('\n')
      .map((l) => pad + l)
      .join('\n');
    return '|\n' + body;
  }

  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return v
      .map((item) => {
        const rendered = formatStructured(item, indent + 1);
        const childPad = '  '.repeat(indent + 1);
        // Object/array items render with their own indent — strip it from
        // the first line so the `- ` lands at the parent's column.
        if (rendered.startsWith(childPad)) {
          return pad + '- ' + rendered.slice(childPad.length);
        }
        return pad + '- ' + rendered;
      })
      .join('\n');
  }

  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries
      .map(([k, val]) => {
        const rendered = formatStructured(val, indent + 1);
        if (rendered.startsWith('|')) {
          return `${pad}${k}: ${rendered}`;
        }
        if (val !== null && typeof val === 'object') {
          return `${pad}${k}:\n${rendered}`;
        }
        return `${pad}${k}: ${rendered}`;
      })
      .join('\n');
  }

  return String(v);
}
