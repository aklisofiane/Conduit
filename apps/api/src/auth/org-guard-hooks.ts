import { APIError } from 'better-auth';
import type { OrganizationOptions } from 'better-auth/plugins';

type OrganizationHooks = NonNullable<OrganizationOptions['organizationHooks']>;

/**
 * Minimal structural slice of the Prisma client this guard needs. Keeping it
 * to `member.count` makes the hook trivially unit-testable with a stub and
 * documents the exact dependency.
 */
export interface OrgMembershipCounter {
  member: { count(args: { where: { userId: string } }): Promise<number> };
}

/**
 * True when the user belongs to no other organization — i.e. the org being
 * deleted is their last one. A membership row exists per (user, org), so the
 * membership count equals the number of orgs the user is in.
 */
export function isLastOrganization(membershipCount: number): boolean {
  return membershipCount <= 1;
}

/**
 * `organizationHooks` guard that blocks deleting a user's only organization.
 * Better Auth deletes the org and returns without touching the session, so a
 * user who deletes their active org is left with a dangling
 * `activeOrganizationId` and no org to fall back to. The web client switches
 * to a surviving org after delete; this hook is the server-side backstop that
 * refuses the delete outright when there is nothing to fall back to.
 */
export function createOrganizationGuardHooks(
  db: OrgMembershipCounter,
): Pick<OrganizationHooks, 'beforeDeleteOrganization'> {
  return {
    beforeDeleteOrganization: async ({ user }) => {
      const membershipCount = await db.member.count({ where: { userId: user.id } });
      if (isLastOrganization(membershipCount)) {
        throw new APIError('BAD_REQUEST', {
          message:
            'You must belong to at least one organization. Create another before deleting this one.',
        });
      }
    },
  };
}
