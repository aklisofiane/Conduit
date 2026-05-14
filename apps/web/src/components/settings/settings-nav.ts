import type { LucideIcon } from 'lucide-react';
import { Key, LayoutGrid } from 'lucide-react';

interface SettingsNavEntry {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

export const SETTINGS_NAV: ReadonlyArray<SettingsNavEntry> = [
  {
    key: 'integrations',
    label: 'Integrations',
    path: '/settings/integrations',
    icon: LayoutGrid,
  },
  {
    key: 'api-keys',
    label: 'API keys',
    path: '/settings/api-keys',
    icon: Key,
  },
];
