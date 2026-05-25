import { useMemo } from 'react';
import type { TriggerConfig } from '@conduit/shared';
import { useConnections } from '../../api/hooks.js';
import type { CredentialRow } from '../../api/types.js';
import {
  ActiveToggleField,
  ConnectionSelect,
  Field,
  PanelFooter,
  PanelHeader,
} from './trigger-panel-common.js';

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
  const platform = trigger.platform.toUpperCase() as CredentialRow['platform'];
  const { data: allConnections = [] } = useConnections();
  const repoConnections = useMemo(
    () =>
      allConnections.filter(
        (c) => c.scope.kind === 'github_repo' && c.credential.platform === platform,
      ),
    [allConnections, platform],
  );

  return (
    <>
      <PanelHeader trigger={trigger} isActive={isActive} title="cron" onClose={onClose} />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-5">
          <Field label="Repo" hint="branch lives on this connection">
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

          <Field
            label="Cron expression"
            hint={
              <>
                5-field POSIX (min hour dom month dow) ·{' '}
                <a
                  href="https://crontab.guru/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-accent)] hover:underline"
                >
                  crontab.guru
                </a>
              </>
            }
          >
            <input
              className="field-input"
              type="text"
              placeholder="0 9 * * *"
              value={trigger.cron}
              onChange={(e) => onChange({ cron: e.target.value })}
            />
          </Field>

          <Field label="Timezone" hint="IANA name — e.g. UTC, America/Los_Angeles, Europe/Paris">
            <input
              className="field-input"
              type="text"
              placeholder="UTC"
              value={trigger.timezone}
              onChange={(e) => onChange({ timezone: e.target.value })}
            />
          </Field>

          <ActiveToggleField isActive={isActive} onActiveChange={onActiveChange} />
        </div>
      </div>

      <PanelFooter saving={saving} dirty={dirty} onSave={onSave} onDiscard={onDiscard} />
    </>
  );
}
