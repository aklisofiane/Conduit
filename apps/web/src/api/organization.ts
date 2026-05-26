import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { authClient } from '../lib/auth-client.js';

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const FIVE_MINUTES = 5 * 60 * 1000;

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
  role: OrgRole;
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
  role: OrgRole;
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
 * switches active org. Keep in sync with hooks in `apps/web/src/api/hooks.ts`.
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
  ['repos'],
  ['viewer-orgs'],
  ['labels'],
];

export function invalidateOrgScopedQueries(qc: QueryClient): Promise<unknown> {
  return Promise.all([
    ...ORG_SCOPED_QUERY_KEYS.map((key) => qc.invalidateQueries({ queryKey: key })),
    qc.invalidateQueries({ queryKey: ORGANIZATIONS_KEY }),
    qc.invalidateQueries({ queryKey: ACTIVE_ORG_KEY }),
    qc.invalidateQueries({ queryKey: ORG_MEMBERS_KEY }),
    qc.invalidateQueries({ queryKey: ORG_INVITATIONS_KEY }),
  ]);
}

type AuthRes<T> = { data: T | null; error: { message?: string; status?: number } | null };

function unwrap<T>(res: AuthRes<T>): T {
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

function unwrapVoid(res: { error: { message?: string; status?: number } | null }, fallback: string): void {
  if (res.error) {
    const err = new Error(res.error.message ?? fallback) as Error & { status?: number };
    err.status = res.error.status;
    throw err;
  }
}

export function useOrganizations() {
  return useQuery({
    queryKey: ORGANIZATIONS_KEY,
    staleTime: FIVE_MINUTES,
    queryFn: async () =>
      unwrap(await authClient.organization.list()) as OrganizationSummary[],
  });
}

export function useActiveOrganization() {
  return useQuery({
    queryKey: ACTIVE_ORG_KEY,
    staleTime: FIVE_MINUTES,
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
      unwrapVoid(await authClient.organization.delete({ organizationId }), 'Could not delete');
    },
    onSuccess: async () => {
      await invalidateOrgScopedQueries(qc);
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { email: string; role: OrgRole }) =>
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
      unwrapVoid(
        await authClient.organization.removeMember({ memberIdOrEmail }),
        'Could not remove',
      );
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
    mutationFn: async (args: { memberId: string; role: OrgRole }) =>
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
      unwrapVoid(
        await authClient.organization.leave({ organizationId }),
        'Could not leave',
      );
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
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const res = await authClient.organization.acceptInvitation({ invitationId });
      unwrapVoid(res, 'Could not accept');
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
      unwrapVoid(res, 'Could not reject');
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USER_INVITATIONS_KEY });
    },
  });
}

export interface InvitationActionDeps {
  invitationId: string;
  mutate: (id: string) => Promise<unknown>;
  setError: (msg: string | null) => void;
  onSettled?: () => void;
}

export async function performInvitationAction(deps: InvitationActionDeps): Promise<boolean> {
  deps.setError(null);
  try {
    await deps.mutate(deps.invitationId);
    deps.onSettled?.();
    return true;
  } catch (e) {
    deps.setError(e instanceof Error ? e.message : 'Action failed');
    return false;
  }
}

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
