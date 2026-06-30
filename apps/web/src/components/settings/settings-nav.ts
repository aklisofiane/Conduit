import type { LucideIcon } from 'lucide-react';
import { Building2, Key, LayoutGrid, Mail, UserRound } from 'lucide-react';

interface SettingsNavEntry {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

export const SETTINGS_NAV: ReadonlyArray<SettingsNavEntry> = [
  {
    key: 'account',
    label: 'Account',
    path: '/settings/account',
    icon: UserRound,
  },
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
  {
    key: 'organization',
    label: 'Organization',
    path: '/settings/organization',
    icon: Building2,
  },
  {
    key: 'invitations',
    label: 'Invitations',
    path: '/settings/invitations',
    icon: Mail,
  },
];
