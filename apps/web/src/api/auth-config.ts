import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';

export interface AuthConfig {
  deployment: 'local' | 'hosted';
  oauthProviders: readonly string[];
  registrationMode: 'open' | 'invite-only';
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'] as const,
    queryFn: () => api.get<AuthConfig>('/auth-config'),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
