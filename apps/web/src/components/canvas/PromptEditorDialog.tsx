import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/cn.js';
import { Dialog, DialogContent, DialogTitle } from '../common/Dialog.js';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/input.js';

/** Char + line counts for the prompt editors. Empty text reads as zero lines. */
export function promptCounts(value: string): { chars: number; lines: number } {
  return {
    chars: value.length,
    lines: value === '' ? 0 : value.split('\n').length,
  };
}

interface PromptEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current instructions from the live draft — reseeds the buffer on open. */
  value: string;
  /** Agent name shown in the header. */
  name: string;
  /** Read-only `provider · model` context tag. */
  contextLabel: string;
  /** Commit the edited text back to the draft (caller still saves separately). */
  onCommit: (next: string) => void;
}

/**
 * Wide, distraction-free editor for an agent's system prompt. Edits a local
 * buffer seeded from the live draft: Done commits via `onCommit`, while
 * Cancel / Esc / overlay-click discard it. The inline textarea in
 * AgentConfigPanel stays the quick-edit path; this is the room to write.
 */
export function PromptEditorDialog({
  open,
  onOpenChange,
  value,
  name,
  contextLabel,
  onCommit,
}: PromptEditorDialogProps) {
  const [buffer, setBuffer] = useState(value);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The buffer is scratch state — resync it to the draft each time we open so a
  // prior Cancel never leaks stale text into the next session. Always reopen on
  // the Write tab so the caret-focus behaviour below stays predictable.
  useEffect(() => {
    if (open) {
      setBuffer(value);
      setMode('write');
    }
  }, [open, value]);

  const { chars, lines } = promptCounts(buffer);

  const commit = () => {
    onCommit(buffer);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[720px]"
        onOpenAutoFocus={(e) => {
          // Take over focus so the caret lands at the end, not the start.
          e.preventDefault();
          const el = textareaRef.current;
          if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
          }
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-divider)] px-5 py-4">
          <DialogTitle className="truncate">
            <span>{name}</span>
            <span className="text-[var(--color-text-muted)]"> · instructions</span>
          </DialogTitle>
          <span className="shrink-0 font-mono text-[11px] text-[var(--color-text-muted)]">
            {contextLabel}
          </span>
        </div>

        <div className="flex gap-1 px-5 pt-3">
          {(['write', 'preview'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'rounded-[var(--radius-sm)] px-2.5 py-1 font-mono text-[11px] capitalize transition-colors',
                mode === m
                  ? 'bg-[var(--color-pill-bg)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              )}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="px-5 pb-4 pt-2">
          {mode === 'write' ? (
            <Textarea
              ref={textareaRef}
              style={{ height: '50vh', resize: 'none' }}
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                }
              }}
              placeholder="You are an agent that…"
            />
          ) : (
            <div
              className="overflow-y-auto rounded-[var(--radius)] border border-[var(--color-divider)] bg-[var(--color-bg)] px-4 py-3"
              style={{ height: '50vh' }}
            >
              {buffer.trim() ? (
                <article className="markdown text-[13px] leading-relaxed text-[var(--color-text)]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{buffer}</ReactMarkdown>
                </article>
              ) : (
                <div className="font-mono text-[12px] text-[var(--color-text-muted)]">
                  Nothing to preview yet.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-divider)] px-5 py-4">
          <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
            {chars} chars · {lines} lines
          </span>
          <div className="flex gap-2">
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="button" onClick={commit}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
