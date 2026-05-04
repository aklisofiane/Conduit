import { useCallback, useEffect, useMemo, useState, type DragEvent as ReactDragEvent } from 'react';
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
} from '@xyflow/react';
import { useParams } from 'react-router-dom';
import type { AgentConfig, Edge, WorkflowDefinition } from '@conduit/shared';
import { AgentNode } from '../components/canvas/AgentNode.js';
import { AgentConfigPanel } from '../components/canvas/AgentConfigPanel.js';
import {
  NodePalette,
  PALETTE_DRAG_MIME,
  type PaletteDragPayload,
} from '../components/canvas/NodePalette.js';
import { TriggerConfigPanel } from '../components/canvas/TriggerConfigPanel.js';
import { TriggerNode } from '../components/canvas/TriggerNode.js';
import { WorkflowEdge } from '../components/canvas/WorkflowEdge.js';
import { WorkflowTabs, type WorkflowTabId } from '../components/layout/WorkflowTabs.js';
import { WorkflowActions } from '../components/layout/WorkflowActions.js';
import { WorkflowRunsList } from '../components/run/WorkflowRunsList.js';
import { useUpdateWorkflow, useWorkflow } from '../api/hooks.js';
import { useWorkflowEditor } from '../state/workflow-editor.js';
import { useTopbarSlots } from '../state/topbar-slots.js';
import { relativeFromNow } from '../lib/time.js';

const NODE_TYPES = { agent: AgentNode, trigger: TriggerNode } as const;
const EDGE_TYPES = { workflow: WorkflowEdge } as const;
const WORKFLOW_EDGE_TYPE = 'workflow';

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
  const rf = useReactFlow();
  const [activeTab, setActiveTab] = useState<WorkflowTabId>('build');

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

  useEffect(() => {
    if (wf) reset(wf.definition);
  }, [wf, reset]);

  useEffect(() => {
    if (!draft) {
      setFlowNodes([]);
      setFlowEdges([]);
      return;
    }
    setFlowNodes((prev) => buildFlowNodes(draft, prev));
    setFlowEdges((prev) => buildFlowEdges(draft, prev));
  }, [draft]);

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
        const dropped = changes.filter(
          (c): c is NodeChange & { type: 'position'; id: string } =>
            c.type === 'position' && c.dragging === false,
        );
        if (dropped.length > 0 && draft) {
          const positions = { ...draft.ui.nodePositions };
          for (const change of dropped) {
            const node = next.find((n) => n.id === change.id);
            if (!node) continue;
            const key = nameForFlowId(draft, node.id) ?? node.id;
            positions[key] = { x: node.position.x, y: node.position.y };
          }
          setDraft({ ...draft, ui: { ...draft.ui, nodePositions: positions } });
        }
        return next;
      });
    },
    [draft, setDraft],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setFlowEdges((current) => {
        const next = applyEdgeChanges(changes, current);
        if (draft && changes.some((c) => c.type === 'remove')) {
          setDraft({ ...draft, edges: flowEdgesToDomain(next, draft) });
        }
        return next;
      });
    },
    [draft, setDraft],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setFlowEdges((current) => {
        const next = addEdge(
          { ...conn, type: WORKFLOW_EDGE_TYPE },
          current,
        );
        if (draft) setDraft({ ...draft, edges: flowEdgesToDomain(next, draft) });
        return next;
      });
    },
    [draft, setDraft],
  );

  const handleAddAgent = useCallback(
    (provider: 'claude' | 'codex', position?: { x: number; y: number }) => {
      if (!draft) return;
      const name = uniqueNodeName(draft, provider === 'claude' ? 'Agent' : 'Codex');
      const agentId = `agent_${Math.random().toString(36).slice(2, 10)}`;
      const drop =
        position ??
        rf.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
      const agent: AgentConfig = {
        id: agentId,
        name,
        provider,
        model: provider === 'claude' ? 'claude-opus-4-6' : 'gpt-5-codex',
        instructions: '',
        mcpServers: [],
        skills: [],
        workspace: { kind: 'fresh-tmpdir' },
      };
      const ui = {
        ...draft.ui,
        nodePositions: { ...draft.ui.nodePositions, [name]: drop },
      };
      setDraft({ ...draft, nodes: [...draft.nodes, agent], ui });
      setSelected(agentId);
    },
    [draft, rf, setDraft, setSelected],
  );

  const handleSelectTrigger = useCallback(() => {
    if (!draft) return;
    const trigger = draft.triggers[0];
    if (!trigger) return;
    const pos = draft.ui.nodePositions[trigger.name] ?? { x: 80, y: 120 };
    rf.setCenter(pos.x + 150, pos.y + 20, { zoom: 1, duration: 400 });
    setSelected(trigger.id);
  }, [draft, rf, setSelected]);

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
        const trigger = draft.triggers[0];
        if (!trigger) return;
        const ui = {
          ...draft.ui,
          nodePositions: { ...draft.ui.nodePositions, [trigger.name]: point },
        };
        setDraft({ ...draft, ui });
        setSelected(trigger.id);
      }
    },
    [draft, rf, handleAddAgent, setDraft, setSelected],
  );

  const handleSave = useCallback(async () => {
    if (!draft || !id) return;
    await updateWorkflow.mutateAsync({ definition: draft });
  }, [draft, id, updateWorkflow]);

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
      />
    ),
    [wf?.isActive, dirty, updateWorkflow.isPending, handleSave],
  );
  useTopbarSlots({ center: tabsSlot, actions: actionsSlot });

  if (!id) return null;
  if (isLoading || !draft) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-[12px] text-[var(--color-text-muted)]">
        Loading workflow…
      </div>
    );
  }

  const selectedAgent = draft.nodes.find((n) => n.id === selectedNodeId);
  const selectedTrigger = draft.triggers.find((t) => t.id === selectedNodeId);
  const lastRunLabel = wf?.updatedAt
    ? `saved · ${relativeFromNow(wf.updatedAt)}`
    : 'unsaved';

  if (activeTab === 'runs') {
    return (
      <div className="flex flex-1 min-h-0 overflow-auto">
        <WorkflowRunsList workflowId={id} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0">
      <NodePalette onAddAgent={handleAddAgent} onSelectTrigger={handleSelectTrigger} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="relative flex-1"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="pointer-events-none absolute left-[14px] top-3 z-[2] flex gap-[6px]">
            <span className="pointer-events-auto rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-2 py-[3px] font-mono text-[11px] text-[var(--color-text-2)]">
              {wf?.name ?? 'workflow'}
            </span>
            <span className="pointer-events-auto rounded-[var(--radius-sm)] border border-[var(--color-divider)] bg-[var(--color-bg-panel)] px-2 py-[3px] font-mono text-[11px] text-[var(--color-text-muted)]">
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
        <AgentConfigPanel
          agent={selectedAgent}
          workflowId={id}
          onChange={(patch) => updateAgent(selectedAgent.id, patch)}
          onSave={handleSave}
          onDiscard={() => wf && reset(wf.definition)}
          onClose={() => setSelected(undefined)}
          saving={updateWorkflow.isPending}
          dirty={dirty}
        />
      )}

      {selectedTrigger && (
        <TriggerConfigPanel
          trigger={selectedTrigger}
          workflowId={id}
          isActive={Boolean(wf?.isActive)}
          onChange={(patch) => updateTrigger(selectedTrigger.id, patch)}
          onActiveChange={(next) => updateWorkflow.mutate({ isActive: next })}
          onSave={handleSave}
          onDiscard={() => wf && reset(wf.definition)}
          onClose={() => setSelected(undefined)}
          saving={updateWorkflow.isPending}
          dirty={dirty}
        />
      )}
    </div>
  );
}

function nameForFlowId(def: WorkflowDefinition, id: string): string | undefined {
  return (
    def.nodes.find((n) => n.id === id)?.name ??
    def.triggers.find((t) => t.id === id)?.name
  );
}

function uniqueNodeName(def: WorkflowDefinition, prefix: string): string {
  const names = new Set([
    ...def.nodes.map((n) => n.name),
    ...def.triggers.map((t) => t.name),
  ]);
  let i = 1;
  while (names.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function flowEdgesToDomain(edges: FlowEdge[], def: WorkflowDefinition): Edge[] {
  const nameById = new Map<string, string>();
  for (const t of def.triggers) nameById.set(t.id, t.name);
  for (const n of def.nodes) nameById.set(n.id, n.name);
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

function buildFlowNodes(draft: WorkflowDefinition, prev: FlowNode[]): FlowNode[] {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  const triggerNodes: FlowNode[] = draft.triggers.map((trigger, i) => {
    const p = prevById.get(trigger.id);
    const position =
      draft.ui.nodePositions[trigger.name] ??
      draft.ui.nodePositions[trigger.id] ??
      p?.position ?? { x: 80, y: 120 + i * 160 };
    return {
      ...(p ?? {}),
      id: trigger.id,
      type: 'trigger',
      position,
      data: { trigger, filterCount: trigger.filters.length },
    };
  });
  const agents: FlowNode[] = draft.nodes.map((agent, i) => {
    const p = prevById.get(agent.id);
    const position =
      draft.ui.nodePositions[agent.name] ??
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

function buildFlowEdges(draft: WorkflowDefinition, prev: FlowEdge[]): FlowEdge[] {
  const prevById = new Map(prev.map((e) => [e.id, e]));
  const idByName = new Map<string, string>();
  for (const t of draft.triggers) idByName.set(t.name, t.id);
  for (const n of draft.nodes) idByName.set(n.name, n.id);

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
