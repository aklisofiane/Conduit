import { create } from 'zustand';
import type {
  AgentConfig,
  TriggerConfig,
  WorkflowDefinition,
  WorkflowMcpServer,
} from '@conduit/shared';

/**
 * Canvas-editor state — selection, dirty tracking, pending edits. Server
 * state lives in TanStack Query; this store is only for UI flags the server
 * doesn't care about. Persistent canvas positions are saved back through
 * `WorkflowDefinition.ui`.
 */
export interface WorkflowEditorState {
  selectedNodeId: string | 'trigger' | undefined;
  dirty: boolean;
  draft: WorkflowDefinition | undefined;
  setSelected: (id: string | 'trigger' | undefined) => void;
  setDraft: (draft: WorkflowDefinition) => void;
  updateAgent: (id: string, patch: Partial<AgentConfig>) => void;
  updateTrigger: (patch: Partial<TriggerConfig>) => void;
  addMcpServer: (server: WorkflowMcpServer) => void;
  updateMcpServer: (id: string, patch: Partial<WorkflowMcpServer>) => void;
  removeMcpServer: (id: string) => void;
  reset: (def: WorkflowDefinition) => void;
  markClean: () => void;
}

export const useWorkflowEditor = create<WorkflowEditorState>((set) => ({
  selectedNodeId: undefined,
  dirty: false,
  draft: undefined,
  setSelected: (id) => set({ selectedNodeId: id }),
  setDraft: (draft) => set({ draft, dirty: true }),
  updateAgent: (id, patch) =>
    set((state) => {
      if (!state.draft) return {};
      const nodes = state.draft.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n));
      return { draft: { ...state.draft, nodes }, dirty: true };
    }),
  updateTrigger: (patch) =>
    set((state) => {
      if (!state.draft) return {};
      return {
        draft: { ...state.draft, trigger: { ...state.draft.trigger, ...patch } },
        dirty: true,
      };
    }),
  addMcpServer: (server) =>
    set((state) => {
      if (!state.draft) return {};
      if (state.draft.mcpServers.some((s) => s.id === server.id)) return {};
      return {
        draft: { ...state.draft, mcpServers: [...state.draft.mcpServers, server] },
        dirty: true,
      };
    }),
  updateMcpServer: (id, patch) =>
    set((state) => {
      if (!state.draft) return {};
      const mcpServers = state.draft.mcpServers.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      );
      return { draft: { ...state.draft, mcpServers }, dirty: true };
    }),
  removeMcpServer: (id) =>
    set((state) => {
      if (!state.draft) return {};
      const mcpServers = state.draft.mcpServers.filter((s) => s.id !== id);
      // Also strip references from every agent so the workflow stays valid.
      const nodes = state.draft.nodes.map((n) => ({
        ...n,
        mcpServers: n.mcpServers.filter((ref) => ref.serverId !== id),
      }));
      return { draft: { ...state.draft, mcpServers, nodes }, dirty: true };
    }),
  reset: (def) => set({ draft: def, dirty: false }),
  markClean: () => set({ dirty: false }),
}));
