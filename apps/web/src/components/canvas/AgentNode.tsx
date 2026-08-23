import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AgentConfig } from '@conduit/shared';
import { nodeSize, type ProviderId } from '../../styles/theme.js';
import { ProviderGlyph } from '../common/BrandGlyph.js';
import { NodeShell, NodeIconTile, NodeTag, NodePill } from '../ui/node.js';
import { cn } from '../../lib/cn.js';

export interface AgentNodeData extends Record<string, unknown> {
  agent: AgentConfig;
}

/**
 * Provider-tinted surfaces that don't have their own primitive (the prompt
 * sheet and footer). The `var(--color-<p>-*)` values are the verbatim
 * `providerStyle()` tokens the old inline `style={}` used; literal class
 * strings keep them visible to the Tailwind scanner.
 */
const promptTint: Record<ProviderId, string> = {
  claude: 'bg-[var(--color-claude-prompt)] border-[var(--color-claude-prompt-border)] font-sans',
  codex: 'bg-[var(--color-codex-prompt)] border-[var(--color-codex-prompt-border)] font-mono',
};
const footerTint: Record<ProviderId, string> = {
  claude: 'bg-[var(--color-claude-footer)] border-[var(--color-claude-prompt-border)]',
  codex: 'bg-[var(--color-codex-footer)] border-[var(--color-codex-prompt-border)]',
};

export function AgentNode({ data, selected }: NodeProps) {
  const { agent } = data as AgentNodeData;
  const provider = agent.provider;

  return (
    <NodeShell
      tone={provider}
      selected={selected}
      style={{ width: nodeSize.agent.width, minHeight: nodeSize.agent.minHeight }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-[10px]">
        <NodeIconTile tone={provider} size="md">
          <ProviderGlyph provider={provider} size={12} color="#FFFFFF" />
        </NodeIconTile>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-base font-semibold leading-none',
            provider === 'codex' ? 'font-mono' : 'font-sans',
          )}
        >
          {agent.name}
        </span>
        <NodeTag tone={provider}>{provider}</NodeTag>
      </div>

      {/* Prompt sheet */}
      <div className="px-[10px] pb-2">
        <div
          className={cn(
            'rounded-[var(--radius)] border px-[10px] py-2 text-caption leading-[1.45] text-[var(--color-text-2)]',
            promptTint[provider],
          )}
        >
          {agent.instructions ? (
            <span className="line-clamp-3 whitespace-pre-wrap">{agent.instructions}</span>
          ) : (
            <span className="text-[var(--color-text-muted)]">
              No instructions yet — click to configure.
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-[6px] px-[10px] pb-2">
        <NodePill tone={provider}>
          <span className="text-[var(--color-text-2)]">{agent.model}</span>
        </NodePill>
      </div>

      {/* Footer */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 border-t px-3 py-[6px] font-mono text-caption text-[var(--color-text-muted)]',
          footerTint[provider],
        )}
      >
        <div className="flex min-w-0 gap-2">
          {agent.mcpServers.length === 0 ? (
            <span>no mcp</span>
          ) : (
            <>
              {agent.mcpServers.slice(0, 3).map((m) => (
                <span key={m.serverId} className="truncate">
                  {m.serverId}
                </span>
              ))}
              {agent.mcpServers.length > 3 && <span>+{agent.mcpServers.length - 3}</span>}
            </>
          )}
        </div>
        <div className="flex shrink-0 gap-[10px]">
          <span>
            {agent.skills.length} skill{agent.skills.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </NodeShell>
  );
}
