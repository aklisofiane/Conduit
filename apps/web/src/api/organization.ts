/**
 * TanStack Query hooks over Better Auth's `organization` plugin client.
 *
 * Centralizes the cache-key shape so the user-menu's switch flow can
 * invalidate every org-scoped key in one call. The plugin endpoints live
 * under `/api/auth/organization/*` and are wrapped by `authClient.organization.*`
 * — no Conduit-side API surface here.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { authClient } from '../lib/auth-client.js';

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt: string | Date;
  metadata?: unknown;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: string | Date;
  user: {
    id: string;
    name?: string | null;
    email: string;
    image?: string | null;
  };
}

export interface OrganizationInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled' | 'expired';
  inviterId: string;
  expiresAt: string | Date;
  createdAt?: string | Date;
}

export interface UserInvitation extends OrganizationInvitation {
  organizationName?: string;
  inviterEmail?: string;
}

export interface ActiveOrganization extends OrganizationSummary {
  members?: OrganizationMember[];
  invitations?: OrganizationInvitation[];
}

export const ORGANIZATIONS_KEY = ['organizations'] as const;
export const ACTIVE_ORG_KEY = ['organization', 'active'] as const;
export const ORG_MEMBERS_KEY = ['organization', 'members'] as const;
export const ORG_INVITATIONS_KEY = ['organization', 'invitations'] as const;
export const USER_INVITATIONS_KEY = ['user', 'invitations'] as const;

/**
 * Top-level cache keys whose values become stale the moment the user
 * switches active org. The switcher hands this list to TanStack Query's
 * `invalidateQueries`. Keep it in sync with hooks in `apps/web/src/api/hooks.ts`.
 */
export const ORG_SCOPED_QUERY_KEYS: readonly (readonly unknown[])[] = [
  ['workflows'],
  ['workflow'],
  ['run'],
  ['credentials'],
  ['connections'],
  ['templates'],
  ['triggers'],
  ['agent-presets'],
  ['skills'],
  ['project-boards'],
  ['labels'],
];

/**
 * Invalidate every org-scoped TanStack Query cache key plus the org-plugin
 * caches so the next render reflects the new active org.
 */
export function invalidateOrgScopedQueries(qc: QueryClient): Promise<unknown> {
  return Promise.all([
    ...ORG_SCOPED_QUERY_KEYS.map((key) => qc.invalidateQueries({ queryKey: key })),
    qc.invalidateQueries({ queryKey: ORGANIZATIONS_KEY }),
    qc.invalidateQueries({ queryKey: ACTIVE_ORG_KEY }),
    qc.invalidateQueries({ queryKey: ORG_MEMBERS_KEY }),
    qc.invalidateQueries({ queryKey: ORG_INVITATIONS_KEY }),
  ]);
}

function unwrap<T>(res: { data: T | null; error: { message?: string; status?: number } | null }): T {
  if (res.error) {
    const err = new Error(res.error.message ?? 'Request failed') as Error & { status?: number };
    err.status = res.error.status;
    throw err;
  }
  if (res.data === null || res.data === undefined) {
    throw new Error('Empty response');
  }
  return res.data;
}

export function useOrganizations() {
  return useQuery({
    queryKey: ORGANIZATIONS_KEY,
    queryFn: async () =>
      unwrap(await authClient.organization.list()) as OrganizationSummary[],
  });
}

export function useActiveOrganization() {
  return useQuery({
    queryKey: ACTIVE_ORG_KEY,
    queryFn: async () =>
      unwrap(await authClient.organization.getFullOrganization()) as ActiveOrganization,
  });
}

export function useOrganizationMembers() {
  return useQuery({
    queryKey: ORG_MEMBERS_KEY,
    queryFn: async () => {
      const res = await authClient.organization.listMembers();
      const data = unwrap(res) as { members?: OrganizationMember[] } | OrganizationMember[];
      return Array.isArray(data) ? data : (data.members ?? []);
    },
  });
}

export function useOrganizationInvitations() {
  return useQuery({
    queryKey: ORG_INVITATIONS_KEY,
    queryFn: async () =>
      unwrap(await authClient.organization.listInvitations()) as OrganizationInvitation[],
  });
}

export function useUserInvitations() {
  return useQuery({
    queryKey: USER_INVITATIONS_KEY,
    queryFn: async () =>
      unwrap(await authClient.organization.listUserInvitations()) as UserInvitation[],
  });
}

export interface SetActiveOrgArgs {
  organizationId?: string;
  organizationSlug?: string;
}

export function useSetActiveOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: SetActiveOrgArgs) =>
      unwrap(await authClient.organization.setActive(args)) as ActiveOrganization,
    onSuccess: async () => {
      await invalidateOrgScopedQueries(qc);
    },
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { name: string; slug?: string }) => {
      const slug = (args.slug ?? slugify(args.name)) || `org-${Math.random().toString(36).slice(2, 8)}`;
      return unwrap(
        await authClient.organization.create({ name: args.name, slug }),
      ) as OrganizationSummary;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORGANIZATIONS_KEY });
    },
  });
}

export function useUpdateOrganization(organizationId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name?: string; slug?: string }) =>
      unwrap(
        await authClient.organization.update({
          organizationId: organizationId ?? '',
          data,
        }),
      ) as OrganizationSummary,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORGANIZATIONS_KEY });
      void qc.invalidateQueries({ queryKey: ACTIVE_ORG_KEY });
    },
  });
}

export function useDeleteOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (organizationId: string) => {
      const res = await authClient.organization.delete({ organizationId });
      if (res.error) {
        const err = new Error(res.error.message ?? 'Could not delete') as Error & { status?: number };
        err.status = res.error.status;
        throw err;
      }
    },
    onSuccess: async () => {
      await invalidateOrgScopedQueries(qc);
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { email: string; role: 'owner' | 'admin' | 'member' }) =>
      unwrap(
        await authClient.organization.inviteMember({
          email: args.email,
          role: args.role,
        }),
      ) as OrganizationInvitation,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORG_INVITATIONS_KEY });
    },
  });
}

export function useCancelInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) =>
      unwrap(
        await authClient.organization.cancelInvitation({ invitationId }),
      ) as OrganizationInvitation,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORG_INVITATIONS_KEY });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberIdOrEmail: string) => {
      const res = await authClient.organization.removeMember({ memberIdOrEmail });
      if (res.error) {
        const err = new Error(res.error.message ?? 'Could not remove') as Error & { status?: number };
        err.status = res.error.status;
        throw err;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORG_MEMBERS_KEY });
      void qc.invalidateQueries({ queryKey: ACTIVE_ORG_KEY });
    },
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { memberId: string; role: 'owner' | 'admin' | 'member' }) =>
      unwrap(
        await authClient.organization.updateMemberRole({
          memberId: args.memberId,
          role: args.role,
        }),
      ) as OrganizationMember,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORG_MEMBERS_KEY });
    },
  });
}

export function useLeaveOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (organizationId: string) => {
      const res = await authClient.organization.leave({ organizationId });
      if (res.error) {
        const err = new Error(res.error.message ?? 'Could not leave') as Error & { status?: number };
        err.status = res.error.status;
        throw err;
      }
    },
    onSuccess: async () => {
      await invalidateOrgScopedQueries(qc);
    },
  });
}

export interface InvitationDetails {
  invitation: OrganizationInvitation;
  organizationName?: string;
  organizationSlug?: string;
  inviterEmail?: string;
}

export async function fetchInvitation(invitationId: string): Promise<InvitationDetails> {
  const res = await authClient.organization.getInvitation({ query: { id: invitationId } });
  if (res.error) {
    const err = new Error(res.error.message ?? 'Invitation not found') as Error & {
      status?: number;
    };
    err.status = res.error.status;
    throw err;
  }
  const raw = res.data as Record<string, unknown> | null;
  if (!raw) throw new Error('Invitation not found');
  const invitation = (raw.invitation ?? raw) as OrganizationInvitation;
  return {
    invitation,
    organizationName: (raw.organizationName as string | undefined) ?? undefined,
    organizationSlug: (raw.organizationSlug as string | undefined) ?? undefined,
    inviterEmail:
      (raw.inviterEmail as string | undefined) ??
      ((raw.inviter as { email?: string } | undefined)?.email ?? undefined),
  };
}

export function useInvitation(invitationId: string | undefined) {
  return useQuery({
    queryKey: ['invitation', invitationId] as const,
    queryFn: () => fetchInvitation(invitationId!),
    enabled: !!invitationId,
    retry: false,
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const res = await authClient.organization.acceptInvitation({ invitationId });
      if (res.error) {
        const err = new Error(res.error.message ?? 'Could not accept') as Error & {
          status?: number;
        };
        err.status = res.error.status;
        throw err;
      }
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USER_INVITATIONS_KEY });
      void qc.invalidateQueries({ queryKey: ORGANIZATIONS_KEY });
    },
  });
}

export function useRejectInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const res = await authClient.organization.rejectInvitation({ invitationId });
      if (res.error) {
        const err = new Error(res.error.message ?? 'Could not reject') as Error & {
          status?: number;
        };
        err.status = res.error.status;
        throw err;
      }
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USER_INVITATIONS_KEY });
    },
  });
}

/** Build the invite-acceptance URL the operator copies and shares. */
export function buildInviteUrl(invitationId: string, origin?: string): string {
  const base =
    origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/accept-invitation/${invitationId}`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
