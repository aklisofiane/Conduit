import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AgentConfig } from '@conduit/shared';
import { cn } from '../../lib/cn.js';

export interface AgentNodeData extends Record<string, unknown> {
  agent: AgentConfig;
}

export function AgentNode({ data, selected }: NodeProps) {
  const { agent } = data as AgentNodeData;
  const tone = agent.provider;
  return (
    <div
      className={cn(
        'flex w-[320px] flex-col gap-2 rounded-xl border bg-[var(--color-bg-1)] p-3 shadow-md',
        tone === 'claude' ? 'border-[var(--color-claude-border)]' : 'border-[var(--color-codex-border)]',
      )}
      style={{
        boxShadow: selected ? '0 0 0 3px rgba(244,244,245,0.12)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />
      <div className="flex items-center gap-2">
        <span className={cn('prov-glyph', tone)}>{tone === 'claude' ? 'C' : 'X'}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px] font-semibold">{agent.name}</div>
          <div className="truncate font-mono text-[10.5px] text-[var(--color-text-3)]">
            <span className={tone === 'claude' ? 'text-[var(--color-claude)]' : 'text-[var(--color-codex)]'}>
              {tone === 'claude' ? 'Claude' : 'Codex'}
            </span>{' '}
            · {agent.model}
          </div>
        </div>
      </div>

      <p className="line-clamp-2 font-mono text-[11.5px] leading-snug text-[var(--color-text-2)]">
        {agent.instructions || (
          <span className="text-[var(--color-text-4)]">No instructions yet — click to configure.</span>
        )}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {agent.mcpServers.slice(0, 3).map((ref) => (
          <span key={ref.serverId} className="chip">
            <span className="dot" />
            {ref.serverId}
          </span>
        ))}
        {agent.mcpServers.length > 3 && (
          <span className="chip text-[var(--color-text-3)]">+{agent.mcpServers.length - 3} more</span>
        )}
        {agent.skills.slice(0, 2).map((s) => (
          <span key={s.skillId} className={cn('chip', tone)}>
            ✶ {s.skillId}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--color-line)] pt-2 font-mono text-[10.5px] text-[var(--color-text-3)]">
        <span>
          {agent.workspace.kind === 'repo-clone'
            ? `repo · ${agent.workspace.ref ?? 'main'}`
            : agent.workspace.kind === 'inherit'
              ? `inherit · ${agent.workspace.fromNode}`
              : agent.workspace.kind === 'ticket-branch'
                ? 'ticket-branch'
                : 'fresh-tmpdir'}
        </span>
        <span>
          {agent.mcpServers.length} mcp · {agent.skills.length} skill{agent.skills.length === 1 ? '' : 's'}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </div>
  );
}
