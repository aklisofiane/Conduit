import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  DEFAULT_MODEL,
  type AgentConfig,
  type AgentProviderId,
  type Edge,
  type TriggerConfig,
  type WorkflowDefinition,
} from '@conduit/shared';
import { AgentNode } from '../components/canvas/AgentNode.js';
import { AgentConfigPanel } from '../components/canvas/AgentConfigPanel.js';
import { InspectorShell } from '../components/canvas/InspectorShell.js';
import {
  NodePalette,
  PALETTE_DRAG_MIME,
  type PaletteDragPayload,
  type PaletteTriggerType,
} from '../components/canvas/NodePalette.js';
import {
  TRIGGER_NODE_TYPES,
  flowTypeForTrigger,
  makeDefaultTrigger,
  triggerPanelComponent,
} from '../components/canvas/trigger-registry.js';
import { WorkflowEdge } from '../components/canvas/WorkflowEdge.js';
import { WorkflowHeaderPill } from '../components/canvas/WorkflowHeaderPill.js';
import { WorkflowTabs, type WorkflowTabId } from '../components/layout/WorkflowTabs.js';
import { WorkflowActions } from '../components/layout/WorkflowActions.js';
import { WorkflowRunsList } from '../components/run/WorkflowRunsList.js';
import { useConnections, useUpdateWorkflow, useWorkflow } from '../api/hooks.js';
import type { ConnectionRow } from '../api/types.js';
import { downloadWorkflowExport } from '../lib/export-workflow.js';
import { useWorkflowEditor } from '../state/workflow-editor.js';
import { useTopbarSlots } from '../state/topbar-slots.js';
import { relativeFromNow } from '../lib/time.js';
import { Button } from '../components/ui/button.js';

const NODE_TYPES: NodeTypes = { agent: AgentNode, ...TRIGGER_NODE_TYPES };
const EDGE_TYPES = { workflow: WorkflowEdge } as const;
const WORKFLOW_EDGE_TYPE = 'workflow';

const PANEL_WIDTH_KEY = 'conduit:canvas:inspector-width';
const PANEL_DEFAULT_WIDTH = 320;
const PANEL_MIN_WIDTH = 280;
const panelMaxWidth = () =>
  typeof window === 'undefined'
    ? 720
    : Math.max(PANEL_MIN_WIDTH, Math.floor(window.innerWidth * 0.4));
const clampPanelWidth = (w: number, max = panelMaxWidth()) =>
  Math.min(max, Math.max(PANEL_MIN_WIDTH, w));

export function CanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

function CanvasInner() {
  const { id } = useParams<{ id: string }>();
  const { data: wf, isLoading } = useWorkflow(id);
  const updateWorkflow = useUpdateWorkflow(id ?? '');
  const connectionsQuery = useConnections();
  const allConnections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  const rf = useReactFlow();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: WorkflowTabId = searchParams.get('tab') === 'runs' ? 'runs' : 'build';
  const setActiveTab = useCallback(
    (tab: WorkflowTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'runs') next.set('tab', 'runs');
          else next.delete('tab');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const draft = useWorkflowEditor((s) => s.draft);
  const selectedNodeId = useWorkflowEditor((s) => s.selectedNodeId);
  const dirty = useWorkflowEditor((s) => s.dirty);
  const setDraft = useWorkflowEditor((s) => s.setDraft);
  const setSelected = useWorkflowEditor((s) => s.setSelected);
  const reset = useWorkflowEditor((s) => s.reset);
  const updateAgent = useWorkflowEditor((s) => s.updateAgent);
  const updateTrigger = useWorkflowEditor((s) => s.updateTrigger);

  // Local state preserves React Flow's `measured` dimensions across draft
  // updates — rebuilding from `draft` would drop them and stick the
  // canvas on visibility: hidden.
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<FlowEdge[]>([]);

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return PANEL_DEFAULT_WIDTH;
    const raw = window.localStorage.getItem(PANEL_WIDTH_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return clampPanelWidth(Number.isFinite(parsed) ? parsed : PANEL_DEFAULT_WIDTH);
  });
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const startPanelResize = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidthRef.current;
    // Cache max for the duration of the drag — viewport changes are handled
    // by the resize listener, and reading `innerWidth` on every pointermove
    // can force layout while the body's cursor/userSelect are mutating.
    const maxWidth = panelMaxWidth();
    const onMove = (e: PointerEvent) => {
      setPanelWidth(clampPanelWidth(startWidth - (e.clientX - startX), maxWidth));
    };
    const onUp = () => {
      dragCleanupRef.current?.();
      window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidthRef.current));
    };
    dragCleanupRef.current = () => {
      dragCleanupRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  useEffect(() => {
    const onResize = () => {
      const before = panelWidthRef.current;
      const next = clampPanelWidth(before);
      if (next === before) return;
      setPanelWidth(next);
      window.localStorage.setItem(PANEL_WIDTH_KEY, String(next));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (wf) reset(wf.definition);
  }, [wf, reset]);

  // Name⇄id lookups shared by the edge mappers and the drop-position
  // handler. Trigger and agent names share one namespace (so `Edge.from`
  // can reference either), so both collections feed both maps. Rebuilt only
  // when the trigger/node sets change.
  const { idByName, nameById } = useMemo(
    () => buildNameIdMaps(draft),
    [draft?.triggers, draft?.nodes],
  );

  useEffect(() => {
    if (!draft) {
      setFlowNodes([]);
      setFlowEdges([]);
      return;
    }
    setFlowNodes((prev) => buildFlowNodes(draft, prev, allConnections));
    setFlowEdges((prev) => buildFlowEdges(draft, prev, idByName));
  }, [draft, allConnections, idByName]);

  useEffect(() => {
    setFlowNodes((prev) => {
      let changed = false;
      const next = prev.map((n) => {
        const selected = n.id === selectedNodeId;
        if (n.selected === selected) return n;
        changed = true;
        return { ...n, selected };
      });
      return changed ? next : prev;
    });
  }, [selectedNodeId]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setFlowNodes((current) => {
        const next = applyNodeChanges(changes, current);
        if (!draft) return next;

        let updated = draft;
        let dirty = false;

        const removed = changes.filter((c) => c.type === 'remove');
        if (removed.length > 0) {
          const ids = new Set(removed.map((c) => c.id));
          updated = {
            ...updated,
            triggers: updated.triggers.filter((t) => !ids.has(t.id)),
            nodes: updated.nodes.filter((n) => !ids.has(n.id)),
          };
          dirty = true;
        }

        const dropped = changes.filter(
          (c): c is NodeChange & { type: 'position'; id: string } =>
            c.type === 'position' && c.dragging === false,
        );
        if (dropped.length > 0) {
          const positions = { ...updated.ui.nodePositions };
          for (const change of dropped) {
            const node = next.find((n) => n.id === change.id);
            if (!node) continue;
            const key = nameById.get(node.id) ?? node.id;
            positions[key] = { x: node.position.x, y: node.position.y };
          }
          updated = { ...updated, ui: { ...updated.ui, nodePositions: positions } };
          dirty = true;
        }

        if (dirty) setDraft(updated);
        return next;
      });
    },
    [draft, nameById, setDraft],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setFlowEdges((current) => {
        const next = applyEdgeChanges(changes, current);
        if (draft && changes.some((c) => c.type === 'remove')) {
          setDraft({ ...draft, edges: flowEdgesToDomain(next, draft, nameById) });
        }
        return next;
      });
    },
    [draft, nameById, setDraft],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setFlowEdges((current) => {
        const next = addEdge({ ...conn, type: WORKFLOW_EDGE_TYPE }, current);
        if (draft) setDraft({ ...draft, edges: flowEdgesToDomain(next, draft, nameById) });
        return next;
      });
    },
    [draft, nameById, setDraft],
  );

  // Shared add-node flow: resolve a drop point (explicit, else canvas
  // centre), pin the new node's position by name, commit the caller's
  // collection change, and select it. `build` receives the resolved
  // position and returns the new node's id plus the def patch to merge.
  const addNode = useCallback(
    (
      name: string,
      position: { x: number; y: number } | undefined,
      build: (drop: { x: number; y: number }) => {
        id: string;
        patch: Partial<WorkflowDefinition>;
      },
    ) => {
      if (!draft) return;
      const drop =
        position ??
        rf.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
      const { id: nodeId, patch } = build(drop);
      const ui = {
        ...draft.ui,
        nodePositions: { ...draft.ui.nodePositions, [name]: drop },
      };
      setDraft({ ...draft, ...patch, ui });
      setSelected(nodeId);
    },
    [draft, rf, setDraft, setSelected],
  );

  const handleAddAgent = useCallback(
    (provider: AgentProviderId, position?: { x: number; y: number }) => {
      if (!draft) return;
      const name = uniqueNodeName(draft, provider === 'claude' ? 'Agent' : 'Codex');
      const agentId = `agent_${Math.random().toString(36).slice(2, 10)}`;
      const agent: AgentConfig = {
        id: agentId,
        name,
        provider,
        model: DEFAULT_MODEL[provider],
        instructions: '',
        mcpServers: [],
        skills: [],
        webSearch: false,
      };
      addNode(name, position, () => ({
        id: agentId,
        patch: { nodes: [...draft.nodes, agent] },
      }));
    },
    [draft, addNode],
  );

  const handleAddTrigger = useCallback(
    (triggerType: PaletteTriggerType, position?: { x: number; y: number }) => {
      if (!draft) return;
      // Swap-by-delete: the palette disables the typed cards when a trigger
      // exists, so this only fires from a clean slate.
      if (draft.triggers.length > 0) return;
      const name = uniqueNodeName(draft, 'Trigger');
      const triggerId = `trigger_${Math.random().toString(36).slice(2, 10)}`;
      const trigger = makeDefaultTrigger(triggerType, triggerId, name);
      addNode(name, position, () => ({
        id: triggerId,
        patch: { triggers: [trigger] },
      }));
    },
    [draft, addNode],
  );

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(PALETTE_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!draft) return;
      const raw = event.dataTransfer.getData(PALETTE_DRAG_MIME);
      if (!raw) return;
      let payload: PaletteDragPayload;
      try {
        payload = JSON.parse(raw) as PaletteDragPayload;
      } catch {
        return;
      }
      const point = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (payload.kind === 'agent') {
        handleAddAgent(payload.provider, point);
      } else {
        handleAddTrigger(payload.triggerType, point);
      }
    },
    [draft, rf, handleAddAgent, handleAddTrigger],
  );

  const handleSave = useCallback(async () => {
    if (!draft || !id) return;
    await updateWorkflow.mutateAsync({ definition: draft });
  }, [draft, id, updateWorkflow]);

  const handleExport = useCallback(() => {
    if (!draft || !wf) return;
    downloadWorkflowExport(
      { name: wf.name, description: wf.description, definition: draft },
      allConnections,
    );
  }, [draft, wf, allConnections]);

  const tabsSlot = useMemo(
    () => <WorkflowTabs active={activeTab} onChange={setActiveTab} />,
    [activeTab],
  );
  const actionsSlot = useMemo(
    () => (
      <WorkflowActions
        isActive={Boolean(wf?.isActive)}
        dirty={dirty}
        saving={updateWorkflow.isPending}
        onSave={handleSave}
        onExport={handleExport}
      />
    ),
    [wf?.isActive, dirty, updateWorkflow.isPending, handleSave, handleExport],
  );
  useTopbarSlots({ center: tabsSlot, actions: actionsSlot });

  if (!id) return null;
  if (isLoading || !draft) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-small text-[var(--color-text-muted)]">
        Loading workflow…
      </div>
    );
  }

  const selectedAgent = draft.nodes.find((n) => n.id === selectedNodeId);
  const selectedTrigger = draft.triggers.find((t) => t.id === selectedNodeId);
  const lastRunLabel = wf?.updatedAt ? `saved · ${relativeFromNow(wf.updatedAt)}` : 'unsaved';

  if (activeTab === 'runs') {
    return (
      <div className="flex flex-1 min-h-0 overflow-auto">
        <WorkflowRunsList workflowId={id} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0">
      <NodePalette
        onAddAgent={handleAddAgent}
        onAddTrigger={handleAddTrigger}
        triggerSlotFilled={draft.triggers.length > 0}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex-1" onDragOver={handleDragOver} onDrop={handleDrop}>
          <div className="pointer-events-none absolute left-[14px] top-3 z-[2] flex gap-[6px]">
            <WorkflowHeaderPill workflowId={id} />
            <span className="pointer-events-auto rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-2 py-[3px] font-mono text-small text-[var(--color-text-muted)]">
              {lastRunLabel}
            </span>
          </div>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelected(node.id)}
            onEdgeClick={(_, edge) => setSelected(edge.id)}
            onPaneClick={() => setSelected(undefined)}
            defaultViewport={draft.ui.viewport}
            fitView
          >
            <Background
              variant={BackgroundVariant.Lines}
              color="var(--canvas-grid-color)"
              gap={32}
            />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      </div>

      {selectedAgent && (
        <InspectorShell width={panelWidth} onResizeStart={startPanelResize}>
          <AgentConfigPanel
            agent={selectedAgent}
            workflowId={id}
            writebackTrigger={
              draft.triggers.find((t) => t.platform === 'github' && t.type !== 'cron') ??
              draft.triggers.find((t) => t.platform === 'github')
            }
            onChange={(patch) => updateAgent(selectedAgent.id, patch)}
            onSave={handleSave}
            onDiscard={() => wf && reset(wf.definition)}
            onClose={() => setSelected(undefined)}
            saving={updateWorkflow.isPending}
            dirty={dirty}
          />
        </InspectorShell>
      )}

      {selectedTrigger && (
        <InspectorShell width={panelWidth} onResizeStart={startPanelResize}>
          <TriggerPanelByType
            key={selectedTrigger.id}
            trigger={selectedTrigger}
            isActive={Boolean(wf?.isActive)}
            onChange={(patch) => updateTrigger(selectedTrigger.id, patch)}
            onActiveChange={(next) => updateWorkflow.mutate({ isActive: next })}
            onSave={handleSave}
            onDiscard={() => wf && reset(wf.definition)}
            onClose={() => setSelected(undefined)}
            saving={updateWorkflow.isPending}
            dirty={dirty}
          />
        </InspectorShell>
      )}
    </div>
  );
}

interface TriggerPanelByTypeProps {
  trigger: TriggerConfig;
  isActive: boolean;
  onChange: (patch: Partial<TriggerConfig>) => void;
  onActiveChange: (next: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  saving: boolean;
  dirty: boolean;
}

function TriggerPanelByType({ trigger, onChange, ...rest }: TriggerPanelByTypeProps) {
  const Panel = triggerPanelComponent(trigger.type);
  if (Panel) {
    return <Panel trigger={trigger} onChange={onChange} {...rest} />;
  }
  // No dedicated editor (today: the legacy `webhook` variant).
  return (
    <div className="flex flex-1 flex-col gap-3 px-5 py-4 font-mono text-small text-[var(--color-text-muted)]">
      <div className="font-sans text-small font-medium text-[var(--color-text)]">
        Webhook trigger
      </div>
      <div>event: {trigger.type === 'webhook' ? trigger.event : ''}</div>
      <div>
        No editor yet — delete this trigger and re-add an Issues, Pull requests, or Schedule trigger
        from the palette.
      </div>
      <Button className="mt-2" onClick={rest.onClose}>
        Close
      </Button>
    </div>
  );
}

/**
 * Name⇄id lookups over the shared trigger/agent namespace. Built once per
 * draft change and threaded through the edge mappers and the drop-position
 * handler so none of them re-scan `triggers`/`nodes` on every call.
 */
function buildNameIdMaps(def: WorkflowDefinition | undefined): {
  idByName: Map<string, string>;
  nameById: Map<string, string>;
} {
  const idByName = new Map<string, string>();
  const nameById = new Map<string, string>();
  if (def) {
    for (const t of def.triggers) {
      idByName.set(t.name, t.id);
      nameById.set(t.id, t.name);
    }
    for (const n of def.nodes) {
      idByName.set(n.name, n.id);
      nameById.set(n.id, n.name);
    }
  }
  return { idByName, nameById };
}

function uniqueNodeName(def: WorkflowDefinition, prefix: string): string {
  const names = new Set([...def.nodes.map((n) => n.name), ...def.triggers.map((t) => t.name)]);
  let i = 1;
  while (names.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function flowEdgesToDomain(
  edges: FlowEdge[],
  def: WorkflowDefinition,
  nameById: Map<string, string>,
): Edge[] {
  const result: Edge[] = [];
  const agentIds = new Set(def.nodes.map((n) => n.id));
  for (const edge of edges) {
    const from = nameById.get(edge.source);
    const to = nameById.get(edge.target);
    // Edge.to must reference an agent; the schema rejects trigger targets.
    if (!from || !to || !agentIds.has(edge.target)) continue;
    result.push({ from, to });
  }
  return result;
}

function buildFlowNodes(
  draft: WorkflowDefinition,
  prev: FlowNode[],
  connections: ConnectionRow[] = [],
): FlowNode[] {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  const connById = new Map(connections.map((c) => [c.id, c]));
  const triggerNodes: FlowNode[] = draft.triggers.map((trigger, i) => {
    const p = prevById.get(trigger.id);
    const position = draft.ui.nodePositions[trigger.name] ??
      draft.ui.nodePositions[trigger.id] ??
      p?.position ?? { x: 80, y: 120 + i * 160 };
    const conn = connById.get(trigger.connectionId);
    const host = conn?.credential.hostUrl ?? undefined;
    return {
      ...(p ?? {}),
      id: trigger.id,
      type: flowTypeForTrigger(trigger.type),
      position,
      data: {
        trigger,
        filterCount: trigger.type === 'cron' ? 0 : trigger.filters.length,
        host,
      },
    };
  });
  const agents: FlowNode[] = draft.nodes.map((agent, i) => {
    const p = prevById.get(agent.id);
    const position = draft.ui.nodePositions[agent.name] ??
      draft.ui.nodePositions[agent.id] ??
      p?.position ?? { x: 440 + i * 360, y: 120 };
    return {
      ...(p ?? {}),
      id: agent.id,
      type: 'agent',
      position,
      data: { agent },
    };
  });
  return [...triggerNodes, ...agents];
}

function buildFlowEdges(
  draft: WorkflowDefinition,
  prev: FlowEdge[],
  idByName: Map<string, string>,
): FlowEdge[] {
  const prevById = new Map(prev.map((e) => [e.id, e]));

  const edges: FlowEdge[] = [];
  for (const e of draft.edges) {
    const sourceId = idByName.get(e.from);
    const targetId = idByName.get(e.to);
    if (!sourceId || !targetId) continue;
    const id = `${sourceId}-${targetId}`;
    edges.push({
      ...(prevById.get(id) ?? {}),
      id,
      source: sourceId,
      target: targetId,
      type: WORKFLOW_EDGE_TYPE,
    });
  }
  return edges;
}
