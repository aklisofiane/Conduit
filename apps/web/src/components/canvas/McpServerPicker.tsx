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
import { connectionLabel } from '../../lib/connection.js';
import { CheckboxListPopover } from '../ui/checkbox-list-popover.js';
import { Select } from '../ui/select.js';
import { Button } from '../ui/button.js';
import { Checkbox } from '../ui/checkbox.js';
import { Input } from '../ui/input.js';
import { Card } from '../ui/card.js';
import { SelectableCard } from '../ui/selectable-card.js';

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
const TRANSPORT_KINDS: ReadonlyArray<McpTransport['kind']> = ['stdio', 'sse', 'streamable-http'];

export function McpServerPicker({ agent, workflowId, onChange }: Props) {
  const addMcpServer = useWorkflowEditor((s) => s.addMcpServer);
  const removeMcpServer = useWorkflowEditor((s) => s.removeMcpServer);
  const servers = useWorkflowEditor((s) => s.draft?.mcpServers ?? []);
  const { data: connections = [] } = useConnections();
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
        <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
          No MCP servers yet. Add one to expose GitHub, Slack, or a custom service to this agent.
        </div>
      )}

      {servers.map((server) => (
        <ServerCard
          key={server.id}
          server={server}
          workflowId={workflowId}
          connections={connections}
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
          connections={connections}
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
        <Button onClick={() => setShowAdd(true)}>+ Add MCP server</Button>
      )}
    </div>
  );
}

function ServerCard({
  server,
  workflowId,
  connections,
  attachedRef,
  onToggleAttached,
  onSetAllowedTools,
  onRemoveFromWorkflow,
}: {
  server: WorkflowMcpServer;
  workflowId: string;
  connections: ConnectionOption[];
  attachedRef: McpServerRef | undefined;
  onToggleAttached: () => void;
  onSetAllowedTools: (tools: string[] | undefined) => void;
  onRemoveFromWorkflow: () => void;
}) {
  const updateMcpServer = useWorkflowEditor((s) => s.updateMcpServer);
  const introspect = useIntrospectMcp();
  const attached = !!attachedRef;

  const handleIntrospect = async () => {
    try {
      const tools = await introspect.mutateAsync({
        transport: server.transport,
        workflowId,
        connectionId: server.connectionId,
      });
      updateMcpServer(server.id, { discoveredTools: tools });
    } catch (e) {
      alert(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <Card
      className={cn(
        'rounded-md bg-[var(--color-pill-bg)] p-3',
        attached ? 'border-[var(--color-divider)]' : 'border-[var(--color-divider)]',
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={attached}
          onCheckedChange={onToggleAttached}
          className="mt-1"
          aria-label={`Attach ${server.name} to this agent`}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 font-mono text-[12px] font-medium">
            {server.name}
            <span className="font-mono text-[10.5px] text-[var(--color-text-muted)]">
              · {server.transport.kind}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-text-muted)]">
            {transportSummary(server.transport)}
          </div>
        </div>
        <Button onClick={onRemoveFromWorkflow} title="Remove from workflow">
          ✕
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
            Connection
          </span>
          <Select
            ariaLabel="Connection"
            placeholder="(none)"
            value={server.connectionId ?? ''}
            onValueChange={(v) =>
              updateMcpServer(server.id, {
                connectionId: v || undefined,
              })
            }
            options={connections.map((c) => ({
              value: c.id,
              label: connectionLabel(c),
            }))}
          />
        </label>
        <Button
          onClick={handleIntrospect}
          disabled={introspect.isPending}
          title="Run tools/list on this server"
        >
          {introspect.isPending ? '…' : server.discoveredTools ? 'Refresh tools' : 'Load tools'}
        </Button>
      </div>

      {attached && server.discoveredTools && (
        <ToolAllowList
          tools={server.discoveredTools}
          allowedTools={attachedRef.allowedTools}
          onChange={onSetAllowedTools}
        />
      )}
    </Card>
  );
}

// Stable accessors so the popover's filter `useMemo` isn't invalidated each render.
const toolName = (t: DiscoveredTool) => t.name;
const toolDescription = (t: DiscoveredTool) => t.description;

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
  const selected = useMemo(
    () => new Set(allowedTools ?? tools.map((t) => t.name)),
    [allowedTools, tools],
  );

  // `undefined` means "all tools" — normalize a full selection back to it so
  // the stored allowlist stays compact and survives the server adding tools.
  const setSelected = (next: Set<string>) => {
    if (next.size === tools.length) onChange(undefined);
    else onChange(Array.from(next));
  };

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  const toggleAll = () => {
    if (allAllowed) onChange([]);
    else onChange(undefined);
  };

  return (
    <div className="mt-3 flex items-center gap-2 border-t border-[var(--color-divider)] pt-3">
      <CheckboxListPopover
        items={tools}
        getId={toolName}
        getLabel={toolName}
        getDescription={toolDescription}
        selectedIds={selected}
        onToggle={toggle}
        onToggleMany={(names, select) => {
          const next = new Set(selected);
          for (const name of names) {
            if (select) next.add(name);
            else next.delete(name);
          }
          setSelected(next);
        }}
        triggerClassName="flex-1"
        maxHeight={320}
        placeholder="Filter tools…"
        emptyLabel="No matching tools"
        triggerLabel={
          allAllowed ? `All tools (${tools.length})` : `${selected.size} of ${tools.length} tools`
        }
        selectAll={{ checked: allAllowed, onToggle: toggleAll, label: 'Select all' }}
      />
    </div>
  );
}

function AddServerForm({
  connections,
  onAdd,
  onCancel,
}: {
  connections: ConnectionOption[];
  onAdd: (server: WorkflowMcpServer) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');

  return (
    <Card className="rounded-md bg-[var(--color-pill-bg)] p-3">
      <div className="flex items-center gap-2">
        <Button
          variant={mode === 'preset' ? 'primary' : 'secondary'}
          onClick={() => setMode('preset')}
        >
          Preset
        </Button>
        <Button
          variant={mode === 'custom' ? 'primary' : 'secondary'}
          onClick={() => setMode('custom')}
        >
          Custom
        </Button>
        <div className="flex-1" />
        <Button onClick={onCancel}>Cancel</Button>
      </div>

      {mode === 'preset' && <PresetPicker connections={connections} onAdd={onAdd} />}
      {mode === 'custom' && <CustomServerForm connections={connections} onAdd={onAdd} />}
    </Card>
  );
}

type ConnectionOption = {
  id: string;
  name: string;
  credential: { platform: string };
};

function PresetPicker({
  connections,
  onAdd,
}: {
  connections: ConnectionOption[];
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
          <SelectableCard
            key={preset.id}
            selected={selected?.id === preset.id}
            onClick={() => setSelected(preset)}
            className="bg-[var(--color-bg-panel)] p-3"
          >
            <div className="font-mono text-[12px] font-medium">{preset.name}</div>
            <div className="mt-1 font-mono text-[10.5px] text-[var(--color-text-muted)]">
              {preset.description}
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-[var(--color-text-muted)]">
              Requires {preset.platform.toLowerCase()} credential · {preset.credentialHint}
            </div>
          </SelectableCard>
        ))}
      </div>

      {selected && (
        <>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
              Connection (optional — can set later)
            </span>
            <Select
              ariaLabel="Connection"
              placeholder="(none)"
              value={connectionId}
              onValueChange={setConnectionId}
              options={eligible.map((c) => ({ value: c.id, label: c.name }))}
            />
            {eligible.length === 0 && (
              <span className="font-mono text-[10.5px] text-[var(--color-text-muted)]">
                No {selected.platform.toLowerCase()} connection yet — add one from the Connections
                page.
              </span>
            )}
          </label>
          <Button variant="primary" onClick={handleAdd}>
            Add {selected.name}
          </Button>
        </>
      )}
    </div>
  );
}

function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder = 'KEY',
  valuePlaceholder = 'value',
}: {
  entries: [string, string][];
  onChange: (next: [string, string][]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const update = (i: number, col: 0 | 1, value: string) => {
    const next = entries.map((row, j) =>
      j === i
        ? ([col === 0 ? value : row[0], col === 1 ? value : row[1]] as [string, string])
        : row,
    );
    onChange(next);
  };

  const remove = (i: number) => onChange(entries.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            className="flex-1 font-mono text-[11px]"
            placeholder={keyPlaceholder}
            value={k}
            onChange={(e) => update(i, 0, e.target.value)}
          />
          <Input
            className="flex-[2] font-mono text-[11px]"
            placeholder={valuePlaceholder}
            value={v}
            onChange={(e) => update(i, 1, e.target.value)}
          />
          <Button onClick={() => remove(i)} title="Remove">
            ✕
          </Button>
        </div>
      ))}
      <Button className="self-start" onClick={() => onChange([...entries, ['', '']])}>
        + Add
      </Button>
    </div>
  );
}

function CustomServerForm({
  connections,
  onAdd,
}: {
  connections: ConnectionOption[];
  onAdd: (server: WorkflowMcpServer) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<McpTransport['kind']>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [envEntries, setEnvEntries] = useState<[string, string][]>([]);
  const [headerEntries, setHeaderEntries] = useState<[string, string][]>([]);
  const [connectionId, setConnectionId] = useState<string>('');

  const canSave =
    name.trim().length > 0 &&
    (kind === 'stdio' ? command.trim().length > 0 : url.trim().length > 0);

  const handleAdd = () => {
    if (!canSave) return;
    const id = `mcp_${Math.random().toString(36).slice(2, 10)}`;

    const toRecord = (entries: [string, string][]) => {
      const obj: Record<string, string> = {};
      for (const [k, v] of entries) {
        const key = k.trim();
        if (key) obj[key] = v;
      }
      return Object.keys(obj).length > 0 ? obj : undefined;
    };

    const transport: McpTransport =
      kind === 'stdio'
        ? {
            kind: 'stdio',
            command: command.trim(),
            args: args
              .split(/\s+/)
              .map((a) => a.trim())
              .filter(Boolean),
            env: toRecord(envEntries),
          }
        : { kind, url: url.trim(), headers: toRecord(headerEntries) };
    onAdd({ id, name: name.trim(), transport, connectionId: connectionId || undefined });
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
          Name
        </span>
        <Input
          placeholder="e.g. Internal API"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
          Transport
        </span>
        <Select
          ariaLabel="Transport"
          value={kind}
          onValueChange={(v) => setKind(v as McpTransport['kind'])}
          options={TRANSPORT_KINDS.map((k) => ({ value: k, label: k }))}
        />
      </label>

      {kind === 'stdio' ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
              Command
            </span>
            <Input placeholder="npx" value={command} onChange={(e) => setCommand(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
              Args (space-separated)
            </span>
            <Input
              placeholder="-y @my-org/mcp-something"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
              Environment variables
            </span>
            <KeyValueEditor
              entries={envEntries}
              onChange={setEnvEntries}
              keyPlaceholder="ENV_VAR"
              valuePlaceholder="value"
            />
          </div>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
              URL
            </span>
            <Input
              placeholder="https://tools.example.com/mcp"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
              Headers
            </span>
            <KeyValueEditor
              entries={headerEntries}
              onChange={setHeaderEntries}
              keyPlaceholder="Header-Name"
              valuePlaceholder="value"
            />
          </div>
        </>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-[var(--color-text-muted)]">
          Connection (optional)
        </span>
        <Select
          ariaLabel="Connection"
          placeholder="(none)"
          value={connectionId}
          onValueChange={setConnectionId}
          options={connections.map((c) => ({
            value: c.id,
            label: connectionLabel(c),
          }))}
        />
      </label>

      <Button variant="primary" disabled={!canSave} onClick={handleAdd}>
        Add server
      </Button>
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
