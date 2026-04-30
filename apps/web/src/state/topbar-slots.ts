import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { create } from 'zustand';

/**
 * Slot store for the global TopChrome — pages mount their workflow-scoped
 * UI (tabs in the centre, actions on the right) into the chrome without
 * coupling routing to the layout.
 *
 * Use the `useTopbarSlots` hook below from inside a page; slots clear on
 * unmount automatically.
 */
interface TopbarSlotsState {
  centerSlot: ReactNode | null;
  actionsSlot: ReactNode | null;
  setCenterSlot: (node: ReactNode | null) => void;
  setActionsSlot: (node: ReactNode | null) => void;
}

export const useTopbarSlotsStore = create<TopbarSlotsState>((set) => ({
  centerSlot: null,
  actionsSlot: null,
  setCenterSlot: (node) => set({ centerSlot: node }),
  setActionsSlot: (node) => set({ actionsSlot: node }),
}));

export function useTopbarSlots(slots: { center?: ReactNode; actions?: ReactNode }) {
  const setCenter = useTopbarSlotsStore((s) => s.setCenterSlot);
  const setActions = useTopbarSlotsStore((s) => s.setActionsSlot);
  const center = slots.center ?? null;
  const actions = slots.actions ?? null;
  useEffect(() => {
    setCenter(center);
    setActions(actions);
    return () => {
      setCenter(null);
      setActions(null);
    };
  }, [center, actions, setCenter, setActions]);
}
