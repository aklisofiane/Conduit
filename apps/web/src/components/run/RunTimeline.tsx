import { useEffect, useRef } from 'react';
import type { ExecutionLogRow } from '../../api/types.js';
import { cn } from '../../lib/cn.js';

interface RunTimelineProps {
  events: ExecutionLogRow[];
  streaming: boolean;
}

export function RunTimeline({ events, streaming }: RunTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!streaming) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [events, streaming]);

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[12px] text-[var(--color-text-4)]">
        No events yet — waiting for the agent to start.
      </div>
    );
  }

  const startTs = events[0] ? new Date(events[0].ts).getTime() : Date.now();

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-6 py-5">
      <div className="space-y-3">
        {events.map((event, idx) => (
          <TimelineEvent key={event.id} event={event} offsetSec={offsetSeconds(event.ts, startTs)} last={idx === events.length - 1 && streaming} />
        ))}
      </div>
    </div>
  );
}

function TimelineEvent({
  event,
  offsetSec,
  last,
}: {
  event: ExecutionLogRow;
  offsetSec: string;
  last: boolean;
}) {
  const payload = event.payload as { type?: string } | null;
  const type = payload?.type ?? event.kind.toLowerCase();
  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-1)] p-3">
      <div className="flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-text-3)]">
        <span className="text-[var(--color-text-4)]">+{offsetSec}s</span>
        <span className={cn('text-[var(--color-text-2)]')}>{type}</span>
      </div>
      <div className="mt-1.5 font-mono text-[12px] leading-relaxed text-[var(--color-text)]">
        {renderBody(event)}
        {last && <span className="cursor" />}
      </div>
    </div>
  );
}

function renderBody(event: ExecutionLogRow): React.ReactNode {
  const payload = event.payload as
    | { type: 'text'; delta: string }
    | { type: 'tool_call'; name: string; input: unknown }
    | { type: 'tool_result'; output: unknown; error?: string }
    | { type: 'usage'; inputTokens: number; outputTokens: number }
    | { type: 'system'; message: string }
    | { type: string; [k: string]: unknown }
    | null;

  if (!payload) return <span className="text-[var(--color-text-3)]">(empty)</span>;

  switch (payload.type) {
    case 'text':
      return <span>{(payload as { delta: string }).delta}</span>;
    case 'tool_call': {
      const p = payload as { name: string; input: unknown };
      return (
        <>
          <div className="text-[var(--color-claude)]">
            → {p.name}
          </div>
          <pre className="mt-1 max-h-32 overflow-auto rounded border border-[var(--color-line)] bg-[var(--color-bg)] p-2 text-[11px] text-[var(--color-text-2)]">
            {formatJson(p.input)}
          </pre>
        </>
      );
    }
    case 'tool_result': {
      const p = payload as { output: unknown; error?: string };
      return (
        <pre
          className={cn(
            'mt-1 max-h-40 overflow-auto rounded border border-[var(--color-line)] bg-[var(--color-bg)] p-2 text-[11px]',
            p.error ? 'text-[var(--color-error)]' : 'text-[var(--color-text-2)]',
          )}
        >
          {p.error ?? formatJson(p.output)}
        </pre>
      );
    }
    case 'usage': {
      const p = payload as { inputTokens: number; outputTokens: number };
      return (
        <span className="text-[var(--color-text-3)]">
          usage · {p.inputTokens} in · {p.outputTokens} out
        </span>
      );
    }
    case 'system':
      return <span className="text-[var(--color-text-2)]">{(payload as { message: string }).message}</span>;
    default:
      return <pre className="text-[11px] text-[var(--color-text-3)]">{formatJson(payload)}</pre>;
  }
}

function offsetSeconds(ts: string, startMs: number): string {
  const diff = (new Date(ts).getTime() - startMs) / 1000;
  return diff.toFixed(1);
}

function formatJson(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
