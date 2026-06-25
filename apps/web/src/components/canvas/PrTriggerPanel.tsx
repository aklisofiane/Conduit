import { useMemo } from 'react';
import { offeredFilterFields } from '@conduit/shared';
import type { TriggerConfig } from '@conduit/shared';
import { useConnections, useListLabels } from '../../api/hooks.js';
import {
  ActiveToggleField,
  ConnectionSelect,
  ensureLabelTarget,
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
  const { data: allConnections = [] } = useConnections();
  const repoConnections = useMemo(
    () =>
      allConnections.filter(
        (c) => c.scope.kind === 'github_repo' || c.scope.kind === 'gitlab_project',
      ),
    [allConnections],
  );

  const labelsQuery = useListLabels({
    connectionId: trigger.connectionId,
    enabled: !!trigger.connectionId,
  });
  const labelOptions = labelsQuery.data?.map((l) => l.name) ?? [];
  const ensureTarget = ensureLabelTarget(repoConnections, trigger.connectionId);

  return (
    <>
      <PanelHeader trigger={trigger} isActive={isActive} title="pull requests" onClose={onClose} />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-5">
          <Field label={trigger.platform === 'gitlab' ? 'Project' : 'Repo'} hint="source connection for events">
            <ConnectionSelect
              connections={repoConnections}
              value={trigger.connectionId}
              onChange={(id) => {
                const conn = allConnections.find((c) => c.id === id);
                const derived = conn?.scope.kind === 'gitlab_project' ? 'gitlab' as const : 'github' as const;
                onChange({ connectionId: id, platform: derived });
              }}
              emptyHint={`No ${trigger.platform === 'gitlab' ? 'project' : 'repo'} connections yet — create one on the Connections page.`}
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
              ensureTarget={ensureTarget}
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
