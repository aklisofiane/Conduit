import { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
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
import { useNavigate, useParams } from 'react-router-dom';
import type { AgentConfig, Edge, WorkflowDefinition } from '@conduit/shared';
import { AgentNode } from '../components/canvas/AgentNode.js';
import { AgentConfigPanel } from '../components/canvas/AgentConfigPanel.js';
import { NodePalette } from '../components/canvas/NodePalette.js';
import { TriggerNode } from '../components/canvas/TriggerNode.js';
import {
  useManualRun,
  useUpdateWorkflow,
  useWorkflow,
} from '../api/hooks.js';
import { useWorkflowEditor } from '../state/workflow-editor.js';
import { relativeFromNow } from '../lib/time.js';

const NODE_TYPES = { agent: AgentNode, trigger: TriggerNode } as const;
const TRIGGER_NODE_ID = '__trigger__';

export function CanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

function CanvasInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: wf, isLoading } = useWorkflow(id);
  const updateWorkflow = useUpdateWorkflow(id ?? '');
  const manualRun = useManualRun();
  const rf = useReactFlow();

  const draft = useWorkflowEditor((s) => s.draft);
  const selectedNodeId = useWorkflowEditor((s) => s.selectedNodeId);
  const dirty = useWorkflowEditor((s) => s.dirty);
  const setDraft = useWorkflowEditor((s) => s.setDraft);
  const setSelected = useWorkflowEditor((s) => s.setSelected);
  const reset = useWorkflowEditor((s) => s.reset);
  const updateAgent = useWorkflowEditor((s) => s.updateAgent);

  useEffect(() => {
    if (wf) reset(wf.definition);
  }, [wf, reset]);

  const flowNodes = useMemo<FlowNode[]>(() => {
    if (!draft) return [];
    const triggerFilters = draft.trigger.filters.length;
    const triggerNode: FlowNode = {
      id: TRIGGER_NODE_ID,
      type: 'trigger',
      position: draft.ui.nodePositions[TRIGGER_NODE_ID] ?? { x: 80, y: 120 },
      data: { trigger: draft.trigger, filterCount: triggerFilters },
      selected: selectedNodeId === 'trigger',
    };
    const agents: FlowNode[] = draft.nodes.map((agent, i) => ({
      id: agent.id,
      type: 'agent',
      position:
        draft.ui.nodePositions[agent.name] ??
        draft.ui.nodePositions[agent.id] ?? {
          x: 440 + i * 360,
          y: 120,
        },
      data: { agent },
      selected: selectedNodeId === agent.id,
    }));
    return [triggerNode, ...agents];
  }, [draft, selectedNodeId]);

  const flowEdges = useMemo<FlowEdge[]>(() => {
    if (!draft) return [];
    const edges: FlowEdge[] = [];
    // Edge from trigger to every root agent (no incoming edges).
    const withIncoming = new Set(draft.edges.map((e) => e.to));
    for (const n of draft.nodes) {
      if (!withIncoming.has(n.name)) {
        edges.push({
          id: `trigger-${n.id}`,
          source: TRIGGER_NODE_ID,
          target: n.id,
        });
      }
    }
    for (const e of draft.edges) {
      const from = draft.nodes.find((n) => n.name === e.from);
      const to = draft.nodes.find((n) => n.name === e.to);
      if (!from || !to) continue;
      edges.push({ id: `${from.id}-${to.id}`, source: from.id, target: to.id });
    }
    return edges;
  }, [draft]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!draft) return;
      const next = applyNodeChanges(changes, flowNodes);
      const ui = { ...draft.ui, nodePositions: { ...draft.ui.nodePositions } };
      for (const n of next) {
        const key = n.id === TRIGGER_NODE_ID ? TRIGGER_NODE_ID : nameForId(draft, n.id) ?? n.id;
        ui.nodePositions[key] = { x: n.position.x, y: n.position.y };
      }
      setDraft({ ...draft, ui });
    },
    [draft, flowNodes, setDraft],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!draft) return;
      const next = applyEdgeChanges(changes, flowEdges);
      const edges = flowEdgesToDomain(next, draft);
      setDraft({ ...draft, edges });
    },
    [draft, flowEdges, setDraft],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!draft) return;
      const next = addEdge(conn, flowEdges);
      const edges = flowEdgesToDomain(next, draft);
      setDraft({ ...draft, edges });
    },
    [draft, flowEdges, setDraft],
  );

  const handleAddAgent = useCallback(
    (provider: 'claude' | 'codex') => {
      if (!draft) return;
      const name = uniqueAgentName(draft, provider === 'claude' ? 'Agent' : 'Codex');
      const id = `agent_${Math.random().toString(36).slice(2, 10)}`;
      const center = rf.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const agent: AgentConfig = {
        id,
        name,
        provider,
        model: provider === 'claude' ? 'claude-opus-4-6' : 'gpt-5-codex',
        instructions: '',
        mcpServers: [],
        skills: [],
        workspace: { kind: 'fresh-tmpdir' },
      };
      const ui = { ...draft.ui, nodePositions: { ...draft.ui.nodePositions, [name]: center } };
      setDraft({ ...draft, nodes: [...draft.nodes, agent], ui });
      setSelected(id);
    },
    [draft, rf, setDraft, setSelected],
  );

  const handleSave = async () => {
    if (!draft || !id) return;
    await updateWorkflow.mutateAsync({ definition: draft });
  };

  const handleRun = async () => {
    if (!id) return;
    const run = await manualRun.mutateAsync({ workflowId: id, body: {} });
    navigate(`/runs/${run.id}`);
  };

  if (!id) return null;
  if (isLoading || !draft) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-[12px] text-[var(--color-text-3)]">
        Loading workflow…
      </div>
    );
  }

  const selectedAgent = draft.nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="flex flex-1 min-h-0">
      <NodePalette onAddAgent={handleAddAgent} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-bg-1)] px-4">
          <button
            className="btn"
            onClick={() => navigate('/')}
            aria-label="Back to workflows"
          >
            ← workflows
          </button>
          <div className="flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-bg-2)] px-2 py-1">
            <span
              className="h-2 w-2 rounded-full"
              style={{
                background: wf?.isActive ? 'var(--color-success)' : 'var(--color-text-4)',
                boxShadow: wf?.isActive ? '0 0 6px var(--color-success)' : undefined,
              }}
            />
            <span className="font-mono text-[12px] font-semibold">{wf?.name}</span>
            <span className="ml-1 font-mono text-[10.5px] text-[var(--color-text-3)]">
              {wf?.updatedAt ? `saved · ${relativeFromNow(wf.updatedAt)}` : 'unsaved'}
            </span>
          </div>
          <div className="flex-1" />
          <button className="btn" onClick={handleSave} disabled={!dirty || updateWorkflow.isPending}>
            {updateWorkflow.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
          <button
            className="btn primary"
            onClick={handleRun}
            disabled={manualRun.isPending || dirty}
            title={dirty ? 'Save changes before running' : 'Start a manual run'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 3l14 9-14 9V3z" />
            </svg>
            Test run
          </button>
        </div>

        <div className="relative flex-1">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) =>
              setSelected(node.id === TRIGGER_NODE_ID ? 'trigger' : node.id)
            }
            onPaneClick={() => setSelected(undefined)}
            defaultViewport={draft.ui.viewport}
            fitView
          >
            <Background color="#2e2e36" gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>

      {selectedAgent && (
        <AgentConfigPanel
          agent={selectedAgent}
          onChange={(patch) => updateAgent(selectedAgent.id, patch)}
          onSave={handleSave}
          onDiscard={() => wf && reset(wf.definition)}
          saving={updateWorkflow.isPending}
          dirty={dirty}
        />
      )}
    </div>
  );
}

function nameForId(def: WorkflowDefinition, id: string): string | undefined {
  return def.nodes.find((n) => n.id === id)?.name;
}

function uniqueAgentName(def: WorkflowDefinition, prefix: string): string {
  const names = new Set(def.nodes.map((n) => n.name));
  let i = 1;
  while (names.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function flowEdgesToDomain(edges: FlowEdge[], def: WorkflowDefinition): Edge[] {
  const nameById = new Map(def.nodes.map((n) => [n.id, n.name]));
  const result: Edge[] = [];
  for (const edge of edges) {
    if (edge.source === TRIGGER_NODE_ID) continue;
    const from = nameById.get(edge.source);
    const to = nameById.get(edge.target);
    if (from && to) result.push({ from, to });
  }
  return result;
}

