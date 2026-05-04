import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExecutionLogRow } from '../../api/types.js';
import { cn } from '../../lib/cn.js';
import {
  prettyToolName,
  summarizeToolCall,
  type ToolStatus,
} from './tool-summary.js';

interface RunTimelineProps {
  events: ExecutionLogRow[];
  streaming: boolean;
}

interface ToolPair {
  call: ExecutionLogRow;
  result?: ExecutionLogRow;
}

type DisplayItem =
  | { kind: 'text'; id: string; ts: string; nodeName: string; delta: string }
  | { kind: 'system'; id: string; ts: string; nodeName: string; message: string }
  | { kind: 'tool'; id: string; ts: string; pair: ToolPair }
  | { kind: 'tool-group'; id: string; ts: string; toolName: string; pairs: ToolPair[] };

export function RunTimeline({ events, streaming }: RunTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const display = useMemo(() => buildDisplay(events), [events]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Drop expanded ids that no longer exist (e.g. a streaming pair that got
  // grouped after another sibling arrived). Keeps the Set bounded.
  useEffect(() => {
    setExpanded((prev) => {
      const valid = collectIds(display);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [display]);

  useEffect(() => {
    if (!streaming) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [events, streaming]);

  if (display.length === 0) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-[var(--color-text-4)]">
        No events yet — waiting for the agent to start.
      </div>
    );
  }

  const startTs = new Date(display[0]!.ts).getTime();
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
          const offset = offsetSeconds(item.ts, startTs);
          switch (item.kind) {
            case 'text':
              return <TextRow key={item.id} item={item} offset={offset} cursor={last} />;
            case 'system':
              return <SystemRow key={item.id} item={item} offset={offset} />;
            case 'tool':
              return (
                <ToolRow
                  key={item.id}
                  item={item}
                  offset={offset}
                  open={expanded.has(item.id)}
                  onToggle={() => toggle(item.id)}
                  cursor={last}
                />
              );
            case 'tool-group':
              return (
                <ToolGroupRow
                  key={item.id}
                  item={item}
                  startTs={startTs}
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
  // Index every tool_result by its tool_use id once so out-of-order or
  // delayed-result streams still pair correctly.
  const resultsById = new Map<string, ExecutionLogRow>();
  for (const ev of events) {
    const p = ev.payload as { type?: string; id?: string } | null;
    if (p?.type === 'tool_result' && typeof p.id === 'string') {
      resultsById.set(p.id, ev);
    }
  }

  // First, build a flat list of items (text/system/tool), coalescing
  // consecutive text deltas — same behavior as before, just over the new
  // discriminated union.
  const flat: DisplayItem[] = [];
  for (const ev of events) {
    const p = ev.payload as { type?: string } | null;
    if (!p) continue;
    if (p.type === 'usage' || ev.kind === 'USAGE') continue;
    if (p.type === 'tool_result') continue; // attached to its call below

    if (p.type === 'text') {
      const delta = (ev.payload as { delta?: string }).delta ?? '';
      const prev = flat[flat.length - 1];
      if (prev?.kind === 'text' && prev.nodeName === ev.nodeName) {
        flat[flat.length - 1] = { ...prev, delta: prev.delta + delta };
      } else {
        flat.push({
          kind: 'text',
          id: ev.id,
          ts: ev.ts,
          nodeName: ev.nodeName ?? '',
          delta,
        });
      }
      continue;
    }

    if (p.type === 'tool_call') {
      const callPayload = ev.payload as { id?: string };
      const result = callPayload.id ? resultsById.get(callPayload.id) : undefined;
      flat.push({
        kind: 'tool',
        id: ev.id,
        ts: ev.ts,
        pair: { call: ev, result },
      });
      continue;
    }

    if (ev.kind === 'SYSTEM' || p.type === 'system') {
      const msg =
        (ev.payload as { message?: string }).message ??
        JSON.stringify(ev.payload, null, 2);
      flat.push({
        kind: 'system',
        id: ev.id,
        ts: ev.ts,
        nodeName: ev.nodeName ?? '',
        message: msg,
      });
      continue;
    }

    // Unknown payload — render it raw via the system row so nothing is dropped.
    flat.push({
      kind: 'system',
      id: ev.id,
      ts: ev.ts,
      nodeName: ev.nodeName ?? '',
      message: JSON.stringify(ev.payload, null, 2),
    });
  }

  // Second pass: collapse runs of ≥ 2 consecutive `tool` items with the same
  // tool name into a single `tool-group`. Anything non-tool breaks the run.
  const out: DisplayItem[] = [];
  let i = 0;
  while (i < flat.length) {
    const item = flat[i]!;
    if (item.kind !== 'tool') {
      out.push(item);
      i++;
      continue;
    }
    const toolName = (item.pair.call.payload as { name?: string }).name ?? '';
    let j = i + 1;
    while (j < flat.length) {
      const next = flat[j];
      if (
        next?.kind === 'tool' &&
        ((next.pair.call.payload as { name?: string }).name ?? '') === toolName
      ) {
        j++;
      } else {
        break;
      }
    }
    if (j - i >= 2) {
      const pairs = flat.slice(i, j).map((it) => (it as Extract<DisplayItem, { kind: 'tool' }>).pair);
      out.push({
        kind: 'tool-group',
        id: `${item.id}+grp`,
        ts: item.ts,
        toolName,
        pairs,
      });
    } else {
      out.push(item);
    }
    i = j;
  }
  return out;
}

function collectIds(items: DisplayItem[]): Set<string> {
  const ids = new Set<string>();
  for (const it of items) {
    ids.add(it.id);
    if (it.kind === 'tool-group') {
      for (const pair of it.pairs) ids.add(pair.call.id);
    }
  }
  return ids;
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
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2.5">
      <div className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-4)]">
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
    <div className="rounded-md border border-dashed border-[var(--color-line)] bg-[var(--color-bg-1)] px-3 py-2">
      <div className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-4)]">
        +{offset}s · system
      </div>
      <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-[var(--color-text-2)]">
        {item.message}
      </pre>
    </div>
  );
}

function ToolRow({
  item,
  offset,
  open,
  onToggle,
  cursor,
}: {
  item: Extract<DisplayItem, { kind: 'tool' }>;
  offset: string;
  open: boolean;
  onToggle: () => void;
  cursor: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <CollapsedToolHeader
        offset={offset}
        pair={item.pair}
        open={open}
        onToggle={onToggle}
        cursor={cursor}
      />
      {open && <ExpandedToolBody pair={item.pair} />}
    </div>
  );
}

function ToolGroupRow({
  item,
  startTs,
  groupOpen,
  expanded,
  onToggle,
  cursor,
}: {
  item: Extract<DisplayItem, { kind: 'tool-group' }>;
  startTs: number;
  groupOpen: boolean;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  cursor: boolean;
}) {
  const aggregateStatus = summarizeGroupStatus(item.pairs);
  return (
    <div className="overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)]">
      <button
        type="button"
        onClick={() => onToggle(item.id)}
        aria-expanded={groupOpen}
        aria-label={`${groupOpen ? 'Collapse' : 'Expand'} ${item.pairs.length} ${prettyToolName(item.toolName)} calls`}
        className="group flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left font-mono text-[11px] text-[var(--color-text-3)] transition-colors hover:bg-[var(--color-bg-2)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-claude)] focus-visible:ring-inset"
      >
        <Chevron open={groupOpen} />
        <span className="w-12 shrink-0 text-[var(--color-text-4)]">+{offsetSeconds(item.ts, startTs)}s</span>
        <span className="shrink-0 text-[var(--color-claude)] group-hover:text-[var(--color-text)]">
          {prettyToolName(item.toolName)}
        </span>
        <span className="shrink-0 text-[var(--color-text-4)]">× {item.pairs.length}</span>
        <span className="flex-1" />
        <StatusPill status={aggregateStatus} label={aggregateStatusLabel(aggregateStatus, item.pairs)} />
        {cursor && !groupOpen && <span className="cursor" />}
      </button>
      {groupOpen && (
        <div>
          {item.pairs.map((pair, idx) => {
            const id = pair.call.id;
            const open = expanded.has(id);
            return (
              <div key={id} className="border-t border-[var(--color-line)]">
                <CollapsedToolHeader
                  offset={offsetSeconds(pair.call.ts, startTs)}
                  pair={pair}
                  open={open}
                  onToggle={() => onToggle(id)}
                  cursor={cursor && idx === item.pairs.length - 1}
                  indented
                  hideName
                />
                {open && <ExpandedToolBody pair={pair} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CollapsedToolHeader({
  offset,
  pair,
  open,
  onToggle,
  cursor,
  indented = false,
  hideName = false,
}: {
  offset: string;
  pair: ToolPair;
  open: boolean;
  onToggle: () => void;
  cursor: boolean;
  indented?: boolean;
  hideName?: boolean;
}) {
  const callPayload = pair.call.payload as { name?: string; input?: unknown };
  const resultPayload = pair.result?.payload as { error?: string; output?: unknown } | undefined;
  const { summary, status } = summarizeToolCall(
    { name: callPayload.name, input: callPayload.input },
    resultPayload ? { error: resultPayload.error, output: resultPayload.output } : undefined,
  );
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left font-mono text-[11.5px] transition-colors hover:bg-[var(--color-bg-2)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-claude)] focus-visible:ring-inset',
        indented && 'pl-8',
      )}
    >
      <Chevron open={open} />
      <span className="w-12 shrink-0 text-[var(--color-text-4)]">+{offset}s</span>
      {!hideName && (
        <span className="shrink-0 text-[var(--color-claude)]">
          {prettyToolName(callPayload.name ?? '')}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[var(--color-text-3)] group-hover:text-[var(--color-text)]">
        {summary}
      </span>
      <StatusPill status={status} />
      {cursor && <span className="cursor" />}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block w-3 shrink-0 text-[var(--color-text-3)] transition-transform duration-150 group-hover:text-[var(--color-text)]',
        open && 'rotate-90',
      )}
    >
      ▸
    </span>
  );
}

function ExpandedToolBody({ pair }: { pair: ToolPair }) {
  const callPayload = pair.call.payload as { input?: unknown };
  const resultPayload = pair.result?.payload as { error?: string; output?: unknown } | undefined;
  return (
    <div className="space-y-2 border-t border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-4)]">
          input
        </div>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-[var(--color-text-2)]">
          {formatJson(callPayload.input)}
        </pre>
      </div>
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-4)]">
          {resultPayload?.error ? 'error' : 'result'}
        </div>
        <pre
          className={cn(
            'mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px]',
            resultPayload?.error ? 'text-[var(--color-error)]' : 'text-[var(--color-text-2)]',
          )}
        >
          {pair.result === undefined
            ? '(streaming…)'
            : resultPayload?.error ?? formatJson(resultPayload?.output)}
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
        status === 'ok' && 'text-[var(--color-text-3)]',
        status === 'pending' && 'italic text-[var(--color-text-4)]',
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

function summarizeGroupStatus(pairs: ToolPair[]): ToolStatus {
  let pending = false;
  let errors = 0;
  for (const p of pairs) {
    if (!p.result) {
      pending = true;
      continue;
    }
    if ((p.result.payload as { error?: string } | null)?.error) errors++;
  }
  if (pending) return 'pending';
  if (errors > 0) return 'error';
  return 'ok';
}

function aggregateStatusLabel(status: ToolStatus, pairs: ToolPair[]): string {
  if (status === 'pending') return 'running';
  if (status === 'error') {
    const errs = pairs.filter(
      (p) => (p.result?.payload as { error?: string } | null)?.error,
    ).length;
    return `${errs} error${errs === 1 ? '' : 's'}`;
  }
  return 'all ok';
}

function offsetSeconds(ts: string, startMs: number): string {
  const diff = (new Date(ts).getTime() - startMs) / 1000;
  return diff.toFixed(1);
}

function formatJson(v: unknown): string {
  if (v === undefined) return '(empty)';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
