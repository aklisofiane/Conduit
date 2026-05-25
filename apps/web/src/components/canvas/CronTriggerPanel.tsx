import { useMemo } from 'react';
import { CRON_EXPRESSION_RE, type TriggerConfig } from '@conduit/shared';
import { useConnections } from '../../api/hooks.js';
import type { CredentialRow } from '../../api/types.js';
import { repoScopeKindFor } from '../../lib/connection.js';
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

  const platform = trigger.platform.toUpperCase() as CredentialRow['platform'];
  const { data: allConnections = [] } = useConnections();
  const repoConnections = useMemo(
    () =>
      allConnections.filter(
        (c) =>
          c.scope.kind === repoScopeKindFor(trigger.platform) &&
          c.credential.platform === platform,
      ),
    [allConnections, platform, trigger.platform],
  );

  return (
    <>
      <PanelHeader trigger={trigger} isActive={isActive} title="schedule" onClose={onClose} />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-5">
          <Field label={trigger.platform === 'gitlab' ? 'Project' : 'Repo'} hint="branch lives on this connection">
            <ConnectionSelect
              connections={repoConnections}
              value={trigger.connectionId}
              onChange={(id) => onChange({ connectionId: id })}
              emptyHint="No repo connections yet — create one on the Connections page."
            />
          </Field>

          <Field label="Branch" hint="cron runs anchor on this branch — v1 is free-text">
            <input
              className="field-input"
              type="text"
              placeholder="main"
              value={trigger.branch}
              onChange={(e) => onChange({ branch: e.target.value })}
            />
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
