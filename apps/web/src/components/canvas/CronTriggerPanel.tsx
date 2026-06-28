import { useMemo } from 'react';
import { CRON_EXPRESSION_RE, type TriggerConfig } from '@conduit/shared';
import { apiErrorMessage } from '../../api/client.js';
import { useConnections, useRepoBranches } from '../../api/hooks.js';
import { repoScopedConnections } from '../../lib/connection.js';
import { SearchSelect } from '../common/SearchSelect.js';
import { Select } from '../common/Select.js';
import { CronScheduleBuilder } from './CronScheduleBuilder.js';
import {
  ActiveToggleField,
  ConnectionSelect,
  Field,
  PanelFooter,
  PanelHeader,
} from './trigger-panel-common.js';

const TIMEZONE_OPTIONS = [
  { value: 'Pacific/Honolulu', label: '(GMT-10:00) Honolulu' },
  { value: 'America/Anchorage', label: '(GMT-09:00) Anchorage' },
  { value: 'America/Los_Angeles', label: '(GMT-08:00) Los Angeles' },
  { value: 'America/Denver', label: '(GMT-07:00) Denver' },
  { value: 'America/Chicago', label: '(GMT-06:00) Chicago' },
  { value: 'America/New_York', label: '(GMT-05:00) New York' },
  { value: 'America/Sao_Paulo', label: '(GMT-03:00) São Paulo' },
  { value: 'UTC', label: '(GMT+00:00) UTC' },
  { value: 'Europe/London', label: '(GMT+00:00) London' },
  { value: 'Europe/Paris', label: '(GMT+01:00) Paris' },
  { value: 'Europe/Berlin', label: '(GMT+01:00) Berlin' },
  { value: 'Africa/Cairo', label: '(GMT+02:00) Cairo' },
  { value: 'Europe/Istanbul', label: '(GMT+03:00) Istanbul' },
  { value: 'Asia/Dubai', label: '(GMT+04:00) Dubai' },
  { value: 'Asia/Kolkata', label: '(GMT+05:30) Mumbai' },
  { value: 'Asia/Bangkok', label: '(GMT+07:00) Bangkok' },
  { value: 'Asia/Singapore', label: '(GMT+08:00) Singapore' },
  { value: 'Asia/Shanghai', label: '(GMT+08:00) Shanghai' },
  { value: 'Asia/Tokyo', label: '(GMT+09:00) Tokyo' },
  { value: 'Australia/Sydney', label: '(GMT+10:00) Sydney' },
  { value: 'Pacific/Auckland', label: '(GMT+12:00) Auckland' },
];

type CronTrigger = Extract<TriggerConfig, { type: 'cron' }>;

/**
 * Option list for the branch picker dropdown. The fetched remote branches are
 * the primary affordance; the current saved branch is surfaced too when it
 * isn't in the fetched list (a just-pushed branch, or one from a connection
 * whose list failed to load) so the closed dropdown still shows the active
 * value rather than appearing empty. The current value goes first; remote
 * branch names are already unique, so no further dedupe is needed.
 */
export function branchPickerOptions(fetched: string[], current: string): string[] {
  const trimmed = current.trim();
  return trimmed && !fetched.includes(trimmed) ? [trimmed, ...fetched] : fetched;
}

export interface CronTriggerPanelProps {
  trigger: CronTrigger;
  isActive: boolean;
  onChange: (patch: Partial<CronTrigger>) => void;
  onActiveChange: (next: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  saving: boolean;
  dirty: boolean;
}

export function CronTriggerPanel({
  trigger,
  isActive,
  onChange,
  onActiveChange,
  onSave,
  onDiscard,
  onClose,
  saving,
  dirty,
}: CronTriggerPanelProps) {
  const cronValid = CRON_EXPRESSION_RE.test(trigger.cron);
  const timezoneOptions = useMemo(() => {
    if (TIMEZONE_OPTIONS.some((o) => o.value === trigger.timezone)) {
      return TIMEZONE_OPTIONS;
    }
    return [
      { value: trigger.timezone, label: trigger.timezone },
      ...TIMEZONE_OPTIONS,
    ];
  }, [trigger.timezone]);

  const { data: allConnections = [] } = useConnections();
  const repoConnections = useMemo(
    () => repoScopedConnections(allConnections),
    [allConnections],
  );

  const branchesQuery = useRepoBranches(trigger.connectionId);
  const branchOptions = useMemo(
    () =>
      branchPickerOptions(branchesQuery.data ?? [], trigger.branch).map((b) => ({
        value: b,
        label: b,
      })),
    [branchesQuery.data, trigger.branch],
  );
  const branchPlaceholder = !trigger.connectionId
    ? 'select a repo first'
    : branchesQuery.isLoading
      ? 'loading branches…'
      : 'main';

  return (
    <>
      <PanelHeader trigger={trigger} isActive={isActive} title="schedule" onClose={onClose} />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-5">
          <Field label={trigger.platform === 'gitlab' ? 'Project' : 'Repo'} hint="branch lives on this connection">
            <ConnectionSelect
              connections={repoConnections}
              value={trigger.connectionId}
              onChange={(id) => {
                const conn = allConnections.find((c) => c.id === id);
                const derived = conn?.scope.kind === 'gitlab_project' ? 'gitlab' as const : 'github' as const;
                onChange({ connectionId: id, platform: derived });
              }}
              emptyHint="No repo connections yet — create one on the Connections page."
            />
          </Field>

          <Field label="Branch" hint="cron runs anchor on this branch">
            <SearchSelect
              ariaLabel="Branch"
              value={trigger.branch}
              onValueChange={(branch) => onChange({ branch })}
              options={branchOptions}
              placeholder={branchPlaceholder}
              disabled={!trigger.connectionId || branchesQuery.isLoading}
            />
            {branchesQuery.isError && (
              <p className="mt-1 font-mono text-[11px] text-[var(--color-danger,#dc322f)]">
                {apiErrorMessage(branchesQuery.error)}
              </p>
            )}
          </Field>

          <CronScheduleBuilder
            value={trigger.cron}
            onChange={(cron) => onChange({ cron })}
          />

          <Field label="Timezone">
            <Select
              ariaLabel="Timezone"
              value={trigger.timezone}
              onValueChange={(tz) => onChange({ timezone: tz })}
              options={timezoneOptions}
            />
          </Field>

          <ActiveToggleField isActive={isActive} onActiveChange={onActiveChange} />
        </div>
      </div>

      <PanelFooter saving={saving} dirty={dirty} valid={cronValid} onSave={onSave} onDiscard={onDiscard} />
    </>
  );
}
