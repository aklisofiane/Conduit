import { create } from 'zustand';
import type { AgentConfig, WorkflowDefinition } from '@conduit/shared';

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
  reset: (def) => set({ draft: def, dirty: false }),
  markClean: () => set({ dirty: false }),
}));
