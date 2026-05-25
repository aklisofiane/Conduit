import { useMemo } from 'react';
import { offeredFilterFields } from '@conduit/shared';
import type { TriggerConfig } from '@conduit/shared';
import { useConnections, useListLabels } from '../../api/hooks.js';
import type { CredentialRow } from '../../api/types.js';
import {
  ActiveToggleField,
  ConnectionSelect,
  Field,
  FilterEditor,
  PanelFooter,
  PanelHeader,
} from './trigger-panel-common.js';

type PrTrigger = Extract<TriggerConfig, { type: 'pull_requests' }>;

export interface PrTriggerPanelProps {
  trigger: PrTrigger;
  isActive: boolean;
  onChange: (patch: Partial<PrTrigger>) => void;
  onActiveChange: (next: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  saving: boolean;
  dirty: boolean;
}

export function PrTriggerPanel({
  trigger,
  isActive,
  onChange,
  onActiveChange,
  onSave,
  onDiscard,
  onClose,
  saving,
  dirty,
}: PrTriggerPanelProps) {
  const platform = trigger.platform.toUpperCase() as CredentialRow['platform'];
  const { data: allConnections = [] } = useConnections();
  const repoConnections = useMemo(
    () =>
      allConnections.filter(
        (c) => c.scope.kind === 'github_repo' && c.credential.platform === platform,
      ),
    [allConnections, platform],
  );

  const labelsQuery = useListLabels({
    connectionId: trigger.connectionId,
    enabled: !!trigger.connectionId,
  });
  const labelOptions = labelsQuery.data?.map((l) => l.name) ?? [];

  return (
    <>
      <PanelHeader trigger={trigger} isActive={isActive} title="pull requests" onClose={onClose} />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-5">
          <Field label="Repo" hint="source connection for events">
            <ConnectionSelect
              connections={repoConnections}
              value={trigger.connectionId}
              onChange={(id) => onChange({ connectionId: id })}
              emptyHint="No repo connections yet — create one on the Connections page."
            />
          </Field>

          <Field label="Poll every" hint="seconds between poll cycles">
            <div className="flex items-center gap-2">
              <input
                className="field-input"
                type="number"
                min={10}
                step={10}
                value={trigger.intervalSec}
                onChange={(e) =>
                  onChange({
                    intervalSec: Math.max(10, Number(e.target.value) || 60),
                  })
                }
              />
              <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                sec
              </span>
            </div>
          </Field>

          <ActiveToggleField isActive={isActive} onActiveChange={onActiveChange} />

          <Field label="Filters" hint="AND-combined — an event must pass all">
            <FilterEditor
              filters={trigger.filters}
              offeredFields={offeredFilterFields(trigger)}
              statusOptions={[]}
              labelOptions={labelOptions}
              onChange={(filters) =>
                // offeredFilterFields restricts the editor to label/pr_state,
                // so the produced array is always assignable back.
                onChange({ filters: filters as PrTrigger['filters'] })
              }
            />
          </Field>
        </div>
      </div>

      <PanelFooter saving={saving} dirty={dirty} onSave={onSave} onDiscard={onDiscard} />
    </>
  );
}
