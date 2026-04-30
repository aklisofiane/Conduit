import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { create } from 'zustand';

interface TopbarSlotsState {
  centerSlot: ReactNode | null;
  actionsSlot: ReactNode | null;
  setCenterSlot: (node: ReactNode | null) => void;
  setActionsSlot: (node: ReactNode | null) => void;
}

export const useTopbarSlotsStore = create<TopbarSlotsState>((set, get) => ({
  centerSlot: null,
  actionsSlot: null,
  setCenterSlot: (node) => {
    if (get().centerSlot !== node) set({ centerSlot: node });
  },
  setActionsSlot: (node) => {
    if (get().actionsSlot !== node) set({ actionsSlot: node });
  },
}));

export function useTopbarSlots(slots: { center?: ReactNode; actions?: ReactNode }) {
  const setCenter = useTopbarSlotsStore((s) => s.setCenterSlot);
  const setActions = useTopbarSlotsStore((s) => s.setActionsSlot);
  const center = slots.center ?? null;
  const actions = slots.actions ?? null;

  useEffect(() => {
    setCenter(center);
  }, [center, setCenter]);
  useEffect(() => {
    setActions(actions);
  }, [actions, setActions]);

  useEffect(
    () => () => {
      setCenter(null);
      setActions(null);
    },
    [setCenter, setActions],
  );
}
