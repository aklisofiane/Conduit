import { useMemo } from 'react';
import { offeredFilterFields } from '@conduit/shared';
import type { TriggerConfig } from '@conduit/shared';
import {
  useConnections,
  useListLabels,
  useListProjectBoards,
} from '../../api/hooks.js';
import {
  ActiveToggleField,
  BoardPickerHint,
  ConnectionSelect,
  Field,
  FilterEditor,
  PanelFooter,
  PanelHeader,
} from './trigger-panel-common.js';
import { ensureLabelTarget, repoScopedConnections } from '../../lib/connection.js';

type IssuesTrigger = Extract<TriggerConfig, { type: 'issues' }>;

export interface IssuesTriggerPanelProps {
  trigger: IssuesTrigger;
  isActive: boolean;
  onChange: (patch: Partial<IssuesTrigger>) => void;
  onActiveChange: (next: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  saving: boolean;
  dirty: boolean;
}

export function IssuesTriggerPanel({
  trigger,
  isActive,
  onChange,
  onActiveChange,
  onSave,
  onDiscard,
  onClose,
  saving,
  dirty,
}: IssuesTriggerPanelProps) {
  const { data: allConnections = [] } = useConnections();
  const repoConnections = useMemo(
    () => repoScopedConnections(allConnections),
    [allConnections],
  );
  const boardConnections = useMemo(
    () => allConnections.filter((c) => c.scope.kind === 'github_projects_v2'),
    [allConnections],
  );

  const hasBoard = !!trigger.boardConnectionId;
  const selectedBoardConnection = useMemo(
    () => boardConnections.find((c) => c.id === trigger.boardConnectionId),
    [boardConnections, trigger.boardConnectionId],
  );
  const boardScope =
    selectedBoardConnection?.scope.kind === 'github_projects_v2'
      ? selectedBoardConnection.scope
      : undefined;

  const boardsQuery = useListProjectBoards({
    connectionId: trigger.boardConnectionId ?? '',
    ownerType: boardScope?.ownerType ?? 'org',
    owner: boardScope?.owner ?? '',
    enabled: hasBoard && !!trigger.boardConnectionId && !!boardScope,
  });

  const labelsQuery = useListLabels({
    connectionId: trigger.connectionId,
    enabled: !!trigger.connectionId,
  });

  const selectedBoardSummary = boardsQuery.data?.find(
    (b) => boardScope && b.number === boardScope.number,
  );
  const statusOptions =
    selectedBoardSummary?.fields.find((f) => f.name === 'Status')?.options ?? [];
  const labelOptions = labelsQuery.data?.map((l) => l.name) ?? [];
  const ensureTarget = ensureLabelTarget(repoConnections, trigger.connectionId);

  return (
    <>
      <PanelHeader trigger={trigger} isActive={isActive} title="issues" onClose={onClose} />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-5">
          <Field label={trigger.platform === 'gitlab' ? 'Project' : 'Repo'} hint="source connection for events">
            <ConnectionSelect
              connections={repoConnections}
              value={trigger.connectionId}
              onChange={(id) => {
                const conn = allConnections.find((c) => c.id === id);
                const derived = conn?.scope.kind === 'gitlab_project' ? 'gitlab' as const : 'github' as const;
                onChange({
                  connectionId: id,
                  platform: derived,
                  ...(derived === 'gitlab' ? { boardConnectionId: undefined } : {}),
                });
              }}
              emptyHint={`No ${trigger.platform === 'gitlab' ? 'project' : 'repo'} connections yet — create one on the Connections page.`}
            />
          </Field>

          {trigger.platform !== 'gitlab' && (
            <Field
              label="Board (optional)"
              hint={hasBoard ? 'board attached unlocks the status filter below' : undefined}
            >
              {hasBoard ? (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <ConnectionSelect
                      connections={boardConnections}
                      value={trigger.boardConnectionId ?? ''}
                      onChange={(id) =>
                        onChange({ boardConnectionId: id || undefined })
                      }
                      emptyHint="No Projects v2 connections yet — create one on the Connections page."
                    />
                  </div>
                  <button
                    type="button"
                    className="btn shrink-0"
                    onClick={() => onChange({ boardConnectionId: undefined })}
                    aria-label="Detach board"
                    title="Detach board"
                  >
                    ×
                  </button>
                </div>
              ) : boardConnections.length === 0 ? (
                <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                  No Projects v2 connections yet — create one on the Connections page.
                </div>
              ) : (
                <button
                  type="button"
                  className="btn w-full"
                  onClick={() => {
                    const first = boardConnections[0];
                    if (first) onChange({ boardConnectionId: first.id });
                  }}
                >
                  + Attach a board
                </button>
              )}
              {hasBoard && selectedBoardSummary && (
                <div className="mt-2">
                  <BoardPickerHint query={boardsQuery} selectedBoard={selectedBoardSummary} />
                </div>
              )}
            </Field>
          )}

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
              statusOptions={statusOptions}
              labelOptions={labelOptions}
              ensureTarget={ensureTarget}
              onChange={(filters) =>
                // offeredFilterFields restricts the editor to label/status,
                // so the produced array is always assignable back.
                onChange({ filters: filters as IssuesTrigger['filters'] })
              }
            />
            {!hasBoard && (
              <div className="mt-2 font-mono text-[11px] text-[var(--color-text-muted)]">
                Only `label` available — attach a board to unlock `status`.
              </div>
            )}
          </Field>
        </div>
      </div>

      <PanelFooter saving={saving} dirty={dirty} onSave={onSave} onDiscard={onDiscard} />
    </>
  );
}
