import type { ComponentType, ReactNode } from 'react';
import type { NodeProps, NodeTypes } from '@xyflow/react';
import type { TriggerConfig } from '@conduit/shared';
import { CircleDot, Clock, GitPullRequest } from 'lucide-react';
import {
  ADDABLE_TRIGGER_TYPES,
  makeDefaultTrigger as makeDefaultTriggerConfig,
  type PaletteTriggerType,
} from '../../lib/trigger-defaults.js';
import { IssuesTriggerNode } from './IssuesTriggerNode.js';
import { PrTriggerNode } from './PrTriggerNode.js';
import { CronTriggerNode } from './CronTriggerNode.js';
import { WebhookTriggerPlaceholderNode } from './WebhookTriggerPlaceholderNode.js';
import { IssuesTriggerPanel } from './IssuesTriggerPanel.js';
import { PrTriggerPanel } from './PrTriggerPanel.js';
import { CronTriggerPanel } from './CronTriggerPanel.js';

/**
 * Single source of truth binding each trigger variant to its React
 * components. Adding a trigger type used to mean a shotgun edit across the
 * palette, the canvas node-type/panel dispatch, and the row-summary switch;
 * those all derive from here (and from `lib/trigger-defaults` for the pure,
 * component-free bits — defaults and the row summary — which the quick-create
 * API path and the workflow list reuse without pulling in canvas components).
 *
 * Every `TriggerConfig['type']` has an entry carrying its React Flow
 * node-type string and node component. The concrete, user-addable variants
 * (`issues` / `pull_requests` / `cron`) additionally carry the palette card
 * and the inspector panel.
 *
 * `webhook` is a stored-only legacy variant: it renders a placeholder node
 * but is not addable (no palette card, no panel) — its inspector fallback
 * lives inline in `CanvasPage`.
 */

type TriggerType = TriggerConfig['type'];
type TriggerOf<T extends PaletteTriggerType> = Extract<TriggerConfig, { type: T }>;

export type { PaletteTriggerType };

export interface PaletteCardInfo {
  name: string;
  description: string;
  icon: ReactNode;
}

/** Props every typed trigger panel accepts, parameterized by its variant. */
export interface TriggerPanelProps<T extends TriggerConfig = TriggerConfig> {
  trigger: T;
  isActive: boolean;
  onChange: (patch: Partial<T>) => void;
  onActiveChange: (next: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  saving: boolean;
  dirty: boolean;
}

interface BaseEntry {
  /** React Flow node-type name — must match a key in `NODE_TYPES`. */
  flowType: string;
  nodeComponent: ComponentType<NodeProps>;
}

interface AddableEntry<T extends PaletteTriggerType> extends BaseEntry {
  addable: true;
  palette: PaletteCardInfo;
  panelComponent: ComponentType<TriggerPanelProps<TriggerOf<T>>>;
}

interface PlaceholderEntry extends BaseEntry {
  addable: false;
}

type TriggerRegistry = {
  [T in TriggerType]: T extends PaletteTriggerType ? AddableEntry<T> : PlaceholderEntry;
};

export const TRIGGER_REGISTRY: TriggerRegistry = {
  issues: {
    addable: true,
    flowType: 'trigger-issues',
    nodeComponent: IssuesTriggerNode,
    panelComponent: IssuesTriggerPanel,
    palette: {
      name: 'Issues',
      description: 'github issues — board or repo',
      icon: <CircleDot size={11} color="#FFFFFF" strokeWidth={1.5} />,
    },
  },
  pull_requests: {
    addable: true,
    flowType: 'trigger-pull-requests',
    nodeComponent: PrTriggerNode,
    panelComponent: PrTriggerPanel,
    palette: {
      name: 'Pull requests',
      description: 'open prs in the repo',
      icon: <GitPullRequest size={11} color="#FFFFFF" strokeWidth={1.5} />,
    },
  },
  cron: {
    addable: true,
    flowType: 'trigger-cron',
    nodeComponent: CronTriggerNode,
    panelComponent: CronTriggerPanel,
    palette: {
      name: 'Schedule',
      description: 'time-driven runs on a branch',
      icon: <Clock size={11} color="#FFFFFF" strokeWidth={1.5} />,
    },
  },
  webhook: {
    addable: false,
    flowType: 'trigger-webhook',
    nodeComponent: WebhookTriggerPlaceholderNode,
  },
};

/** The addable variants, in palette order. */
export const ADDABLE_TRIGGERS = ADDABLE_TRIGGER_TYPES.map((type) => ({
  type,
  ...TRIGGER_REGISTRY[type],
}));

/** React Flow `nodeTypes` map (trigger entries only — the `agent` node is
 *  merged in by the canvas). Keyed by each entry's `flowType`. */
export const TRIGGER_NODE_TYPES: NodeTypes = Object.fromEntries(
  (Object.keys(TRIGGER_REGISTRY) as TriggerType[]).map((type) => {
    const entry = TRIGGER_REGISTRY[type];
    return [entry.flowType, entry.nodeComponent];
  }),
);

/** React Flow node-type name for a given trigger variant. */
export function flowTypeForTrigger(type: TriggerType): string {
  return TRIGGER_REGISTRY[type].flowType;
}

/** Default config for a freshly added trigger of an addable variant.
 *  Delegates to the component-free defaults in `lib/trigger-defaults`. */
export function makeDefaultTrigger(
  triggerType: PaletteTriggerType,
  id: string,
  name: string,
): TriggerConfig {
  return makeDefaultTriggerConfig(triggerType, { id, name });
}

/** The inspector panel component for an addable trigger, or `undefined` for
 *  variants without a dedicated editor (today: `webhook`). The cast bridges
 *  the per-variant panel prop type to the generic call site; the registry
 *  key guarantees the rendered `trigger` matches. */
export function triggerPanelComponent(
  type: TriggerType,
): ComponentType<TriggerPanelProps> | undefined {
  const entry = TRIGGER_REGISTRY[type];
  return entry.addable
    ? (entry.panelComponent as ComponentType<TriggerPanelProps>)
    : undefined;
}
