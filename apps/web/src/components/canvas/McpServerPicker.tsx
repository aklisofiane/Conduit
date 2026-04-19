import { useMemo, useState } from 'react';
import type {
  AgentConfig,
  DiscoveredTool,
  McpPreset,
  McpServerRef,
  McpTransport,
  WorkflowMcpServer,
} from '@conduit/shared';
import { MCP_PRESETS } from '@conduit/shared';
import { ApiError } from '../../api/client.js';
import { useConnections, useIntrospectMcp } from '../../api/hooks.js';
import { useWorkflowEditor } from '../../state/workflow-editor.js';
import { cn } from '../../lib/cn.js';

interface Props {
  agent: AgentConfig;
  workflowId: string;
  onChange: (patch: Partial<AgentConfig>) => void;
}

/**
 * MCP server picker in the agent config panel. Two layers:
 *
 *   1. Workflow-level — declare the server (transport, connection binding).
 *      Stored in `WorkflowDefinition.mcpServers`.
 *   2. Agent-level — attach the server to the current agent, optionally
 *      filter which tools the agent can call.
 *
 * The cached tool list from the last introspection lives on the server
 * (`discoveredTools`), so reopening the panel doesn't re-hit the MCP binary.
 * "Refresh tools" re-runs introspection on demand.
 */
export function McpServerPicker({ agent, workflowId, onChange }: Props) {
  const addMcpServer = useWorkflowEditor((s) => s.addMcpServer);
  const removeMcpServer = useWorkflowEditor((s) => s.removeMcpServer);
  const servers = useWorkflowEditor((s) => s.draft?.mcpServers ?? []);
  const [showAdd, setShowAdd] = useState(false);

  const attachedByServerId = useMemo(
    () => new Map(agent.mcpServers.map((r) => [r.serverId, r])),
    [agent.mcpServers],
  );

  const toggleAttached = (serverId: string) => {
    if (attachedByServerId.has(serverId)) {
      onChange({
        mcpServers: agent.mcpServers.filter((r) => r.serverId !== serverId),
      });
    } else {
      onChange({ mcpServers: [...agent.mcpServers, { serverId }] });
    }
  };

  const setAllowedTools = (serverId: string, allowedTools: string[] | undefined) => {
    onChange({
      mcpServers: agent.mcpServers.map((r) =>
        r.serverId === serverId ? { ...r, allowedTools } : r,
      ),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {servers.length === 0 && !showAdd && (
        <div className="font-mono text-[11px] text-[var(--color-text-4)]">
          No MCP servers yet. Add one to expose GitHub, Slack, or a custom service to this agent.
        </div>
      )}

      {servers.map((server) => (
        <ServerCard
          key={server.id}
          server={server}
          workflowId={workflowId}
          attachedRef={attachedByServerId.get(server.id)}
          onToggleAttached={() => toggleAttached(server.id)}
          onSetAllowedTools={(tools) => setAllowedTools(server.id, tools)}
          onRemoveFromWorkflow={() => {
            if (!confirm(`Remove server "${server.name}" from the workflow?`)) return;
            removeMcpServer(server.id);
          }}
        />
      ))}

      {showAdd ? (
        <AddServerForm
          workflowId={workflowId}
          onCancel={() => setShowAdd(false)}
          onAdd={(server) => {
            addMcpServer(server);
            onChange({
              mcpServers: [...agent.mcpServers, { serverId: server.id }],
            });
            setShowAdd(false);
          }}
        />
      ) : (
        <button className="btn" onClick={() => setShowAdd(true)}>
          + Add MCP server
        </button>
      )}
    </div>
  );
}

function ServerCard({
  server,
  workflowId,
  attachedRef,
  onToggleAttached,
  onSetAllowedTools,
  onRemoveFromWorkflow,
}: {
  server: WorkflowMcpServer;
  workflowId: string;
  attachedRef: McpServerRef | undefined;
  onToggleAttached: () => void;
  onSetAllowedTools: (tools: string[] | undefined) => void;
  onRemoveFromWorkflow: () => void;
}) {
  const updateMcpServer = useWorkflowEditor((s) => s.updateMcpServer);
  const { data: connections = [] } = useConnections(workflowId);
  const introspect = useIntrospectMcp();
  const attached = !!attachedRef;

  const handleIntrospect = async () => {
    try {
      const tools = await introspect.mutateAsync({ transport: server.transport });
      updateMcpServer(server.id, { discoveredTools: tools });
    } catch (e) {
      alert(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div
      className={cn(
        'rounded-md border bg-[var(--color-bg-2)] p-3',
        attached ? 'border-[var(--color-line-2)]' : 'border-[var(--color-line)]',
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={attached}
          onChange={onToggleAttached}
          className="mt-1"
          aria-label={`Attach ${server.name} to this agent`}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 font-mono text-[12px] font-medium">
            {server.name}
            <span className="font-mono text-[10.5px] text-[var(--color-text-3)]">
              · {server.transport.kind}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-text-3)]">
            {transportSummary(server.transport)}
          </div>
        </div>
        <button
          className="btn"
          onClick={onRemoveFromWorkflow}
          title="Remove from workflow"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
            Connection
          </span>
          <select
            className="field-input"
            value={server.connectionId ?? ''}
            onChange={(e) =>
              updateMcpServer(server.id, {
                connectionId: e.target.value || undefined,
              })
            }
          >
            <option value="">(none)</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.alias} · {c.credential.platform.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn"
          onClick={handleIntrospect}
          disabled={introspect.isPending}
          title="Run tools/list on this server"
        >
          {introspect.isPending ? '…' : server.discoveredTools ? 'Refresh tools' : 'Load tools'}
        </button>
      </div>

      {attached && server.discoveredTools && (
        <ToolAllowList
          tools={server.discoveredTools}
          allowedTools={attachedRef.allowedTools}
          onChange={onSetAllowedTools}
        />
      )}
    </div>
  );
}

function ToolAllowList({
  tools,
  allowedTools,
  onChange,
}: {
  tools: DiscoveredTool[];
  allowedTools: string[] | undefined;
  onChange: (next: string[] | undefined) => void;
}) {
  const allAllowed = allowedTools === undefined;
  const selected = new Set(allowedTools ?? tools.map((t) => t.name));

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);

    if (next.size === tools.length) onChange(undefined);
    else onChange(Array.from(next));
  };

  return (
    <div className="mt-3 border-t border-[var(--color-line)] pt-3">
      <div className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
        <span>Allowed tools ({selected.size}/{tools.length})</span>
        {!allAllowed && (
          <button className="btn" onClick={() => onChange(undefined)}>
            Allow all
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-1">
        {tools.map((tool) => (
          <label
            key={tool.name}
            className="flex items-start gap-2 rounded px-1 py-1 hover:bg-[var(--color-bg-3)]"
          >
            <input
              type="checkbox"
              checked={selected.has(tool.name)}
              onChange={() => toggle(tool.name)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="font-mono text-[11.5px]">{tool.name}</div>
              {tool.description && (
                <div className="font-mono text-[10.5px] text-[var(--color-text-3)]">
                  {tool.description}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function AddServerForm({
  workflowId,
  onAdd,
  onCancel,
}: {
  workflowId: string;
  onAdd: (server: WorkflowMcpServer) => void;
  onCancel: () => void;
}) {
  const { data: connections = [] } = useConnections(workflowId);
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');

  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] p-3">
      <div className="flex items-center gap-2">
        <button
          className={cn('btn', mode === 'preset' && 'primary')}
          onClick={() => setMode('preset')}
        >
          Preset
        </button>
        <button
          className={cn('btn', mode === 'custom' && 'primary')}
          onClick={() => setMode('custom')}
        >
          Custom
        </button>
        <div className="flex-1" />
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {mode === 'preset' && (
        <PresetPicker
          connections={connections}
          onAdd={(server) => onAdd(server)}
        />
      )}
      {mode === 'custom' && (
        <CustomServerForm
          connections={connections}
          onAdd={(server) => onAdd(server)}
        />
      )}
    </div>
  );
}

function PresetPicker({
  connections,
  onAdd,
}: {
  connections: Array<{ id: string; alias: string; credential: { platform: string } }>;
  onAdd: (server: WorkflowMcpServer) => void;
}) {
  const [selected, setSelected] = useState<McpPreset | null>(null);
  const [connectionId, setConnectionId] = useState<string>('');

  const eligible = selected
    ? connections.filter((c) => c.credential.platform === selected.platform)
    : [];

  const handleAdd = () => {
    if (!selected) return;
    const id = `${selected.id}_${Math.random().toString(36).slice(2, 8)}`;
    onAdd({
      id,
      name: selected.name,
      transport: selected.transport,
      connectionId: connectionId || undefined,
    });
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2">
        {MCP_PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={cn(
              'rounded-md border bg-[var(--color-bg-1)] p-3 text-left transition-colors',
              selected?.id === preset.id
                ? 'border-[var(--color-line-2)]'
                : 'border-[var(--color-line)] hover:border-[var(--color-line-2)]',
            )}
            onClick={() => setSelected(preset)}
          >
            <div className="font-mono text-[12px] font-medium">{preset.name}</div>
            <div className="mt-1 font-mono text-[10.5px] text-[var(--color-text-3)]">
              {preset.description}
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-[var(--color-text-4)]">
              Requires {preset.platform.toLowerCase()} credential · {preset.credentialHint}
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Connection (optional — can set later)
            </span>
            <select
              className="field-input"
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
            >
              <option value="">(none)</option>
              {eligible.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.alias}
                </option>
              ))}
            </select>
            {eligible.length === 0 && (
              <span className="font-mono text-[10.5px] text-[var(--color-text-4)]">
                No {selected.platform.toLowerCase()} connection yet — add one from the Connections page.
              </span>
            )}
          </label>
          <button className="btn primary" onClick={handleAdd}>
            Add {selected.name}
          </button>
        </>
      )}
    </div>
  );
}

function CustomServerForm({
  connections,
  onAdd,
}: {
  connections: Array<{ id: string; alias: string; credential: { platform: string } }>;
  onAdd: (server: WorkflowMcpServer) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<McpTransport['kind']>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [connectionId, setConnectionId] = useState<string>('');

  const canSave =
    name.trim().length > 0 &&
    (kind === 'stdio' ? command.trim().length > 0 : url.trim().length > 0);

  const handleAdd = () => {
    if (!canSave) return;
    const id = `mcp_${Math.random().toString(36).slice(2, 10)}`;
    const transport: McpTransport =
      kind === 'stdio'
        ? {
            kind: 'stdio',
            command: command.trim(),
            args: args
              .split(/\s+/)
              .map((a) => a.trim())
              .filter(Boolean),
          }
        : { kind, url: url.trim() };
    onAdd({ id, name: name.trim(), transport, connectionId: connectionId || undefined });
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
          Name
        </span>
        <input
          className="field-input"
          placeholder="e.g. Internal API"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
          Transport
        </span>
        <select
          className="field-input"
          value={kind}
          onChange={(e) => setKind(e.target.value as McpTransport['kind'])}
        >
          <option value="stdio">stdio</option>
          <option value="sse">sse</option>
          <option value="streamable-http">streamable-http</option>
        </select>
      </label>

      {kind === 'stdio' ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Command
            </span>
            <input
              className="field-input"
              placeholder="npx"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
              Args (space-separated)
            </span>
            <input
              className="field-input"
              placeholder="-y @my-org/mcp-something"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
            URL
          </span>
          <input
            className="field-input"
            placeholder="https://tools.example.com/mcp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-3)]">
          Connection (optional)
        </span>
        <select
          className="field-input"
          value={connectionId}
          onChange={(e) => setConnectionId(e.target.value)}
        >
          <option value="">(none)</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.alias} · {c.credential.platform.toLowerCase()}
            </option>
          ))}
        </select>
      </label>

      <button className="btn primary" disabled={!canSave} onClick={handleAdd}>
        Add server
      </button>
    </div>
  );
}

function transportSummary(transport: McpTransport): string {
  if (transport.kind === 'stdio') {
    const args = transport.args?.length ? ` ${transport.args.join(' ')}` : '';
    return `${transport.command}${args}`;
  }
  return transport.url;
}
