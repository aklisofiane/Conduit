import type { IconName } from '../canvas/Icon.js';

interface SettingsNavEntry {
  key: string;
  label: string;
  path: string;
  icon: IconName;
}

export const SETTINGS_NAV: ReadonlyArray<SettingsNavEntry> = [
  {
    key: 'integrations',
    label: 'Integrations',
    path: '/settings/integrations',
    icon: 'grid',
  },
  {
    key: 'api-keys',
    label: 'API keys',
    path: '/settings/api-keys',
    icon: 'key',
  },
];
