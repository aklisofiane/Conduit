import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AgentConfig } from '@conduit/shared';
import {
  nodeSize,
  providerStyle,
  tokens,
  type ProviderId,
} from '../../styles/theme.js';
import { ProviderGlyph } from '../common/BrandGlyph.js';

export interface AgentNodeData extends Record<string, unknown> {
  agent: AgentConfig;
}

export function AgentNode({ data, selected }: NodeProps) {
  const { agent } = data as AgentNodeData;
  const provider = agent.provider;
  const ps = providerStyle(provider);

  return (
    <div
      className="overflow-hidden rounded-[var(--radius)] transition-all"
      style={{
        width: nodeSize.agent.width,
        minHeight: nodeSize.agent.minHeight,
        background: ps.card,
        border: `1px solid ${selected ? ps.mark : ps.border}`,
        boxShadow: selected
          ? `${tokens.shadow.focus}, ${tokens.shadow.node}`
          : tokens.shadow.node,
        fontFamily: tokens.font.sans,
        color: tokens.color.text,
      }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-[10px]">
        <span
          className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[var(--radius)]"
          style={{ background: ps.mark }}
        >
          <ProviderGlyph provider={provider} size={12} color="#FFFFFF" />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-none"
          style={{ fontFamily: ps.font }}
        >
          {agent.name}
        </span>
        <ProviderTag provider={provider} />
      </div>

      {/* Prompt sheet */}
      <div className="px-[10px] pb-2">
        <div
          className="rounded-[var(--radius)] px-[10px] py-2 text-[11.5px] leading-[1.45]"
          style={{
            background: ps.prompt,
            border: `1px solid ${ps.promptBorder}`,
            color: tokens.color.text2,
            fontFamily: ps.font,
          }}
        >
          {agent.instructions ? (
            <span className="line-clamp-3 whitespace-pre-wrap">
              {agent.instructions}
            </span>
          ) : (
            <span style={{ color: tokens.color.textMuted }}>
              No instructions yet — click to configure.
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-[6px] px-[10px] pb-2">
        <NodePill borderColor={ps.promptBorder} bg={ps.prompt}>
          <span style={{ color: tokens.color.text2 }}>{agent.model}</span>
        </NodePill>
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-[6px] font-mono text-[10px]"
        style={{
          background: ps.footer,
          borderTop: `1px solid ${ps.promptBorder}`,
          color: tokens.color.textMuted,
        }}
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
              {agent.mcpServers.length > 3 && (
                <span>+{agent.mcpServers.length - 3}</span>
              )}
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
    </div>
  );
}

function ProviderTag({ provider }: { provider: ProviderId }) {
  const ps = providerStyle(provider);
  return (
    <span
      className="ml-auto rounded-[var(--radius-sm)] px-[6px] py-[2px] font-mono text-[9px] font-semibold uppercase tracking-[0.06em]"
      style={{ background: ps.tagBg, color: ps.tagText }}
    >
      {provider}
    </span>
  );
}

function NodePill({
  children,
  bg,
  borderColor,
}: {
  children: React.ReactNode;
  bg: string;
  borderColor: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-[6px] rounded-[var(--radius-sm)] px-[6px] py-[2px] font-mono text-[10px]"
      style={{ background: bg, border: `1px solid ${borderColor}` }}
    >
      {children}
    </span>
  );
}

