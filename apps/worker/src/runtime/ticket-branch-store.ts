import type { TicketBranchRow, TicketBranchStore } from '@conduit/agent';
import { deriveSlug, formatBranchName } from '@conduit/agent';
import { prisma } from './prisma';

/**
 * `TicketBranchStore` backed by the Prisma `TicketBranch` model. Owns the
 * slug derivation on first create so the workspace manager never guesses a
 * different slug than the one persisted.
 *
 * Tenant-scoped — the unique key is
 * `(orgId, platform, hostUrl, owner, repo, ticketId)`. Within one org, a
 * Worker and a Critic pointing at the same ticket converge on one row; two
 * orgs working the same Github repo / ticket get distinct rows (and slugs)
 * so naming doesn't collide across tenants.
 */
export function makeTicketBranchStore(): TicketBranchStore {
  return {
    async upsert(input) {
      const platform = input.platform === 'github' ? 'GITHUB' : 'GITLAB';
      const slug = deriveSlug(input.ticketTitle);
      const branchName = formatBranchName(input.ticketId, slug);
      // On collision, `update: {}` preserves the first-write slug/branchName —
      // later runs must read back the row that iteration 1 created verbatim.
      const row = await prisma().ticketBranch.upsert({
        where: {
          orgId_platform_hostUrl_owner_repo_ticketId: {
            orgId: input.orgId,
            platform,
            hostUrl: input.hostUrl,
            owner: input.owner,
            repo: input.repo,
            ticketId: input.ticketId,
          },
        },
        create: {
          orgId: input.orgId,
          platform,
          hostUrl: input.hostUrl,
          owner: input.owner,
          repo: input.repo,
          ticketId: input.ticketId,
          slug,
          branchName,
          baseRef: input.baseRef,
        },
        update: {},
      });
      return toRow(row);
    },
    async find(key) {
      const platform = key.platform === 'github' ? 'GITHUB' : 'GITLAB';
      const row = await prisma().ticketBranch.findUnique({
        where: {
          orgId_platform_hostUrl_owner_repo_ticketId: {
            orgId: key.orgId,
            platform,
            hostUrl: key.hostUrl,
            owner: key.owner,
            repo: key.repo,
            ticketId: key.ticketId,
          },
        },
      });
      return row ? toRow(row) : null;
    },
    async markRunStart(id) {
      await prisma().ticketBranch.update({
        where: { id },
        data: { lastRunAt: new Date() },
      });
    },
  };
}

function toRow(row: {
  id: string;
  platform: 'GITHUB' | 'GITLAB' | 'JIRA' | 'SLACK' | 'DISCORD';
  hostUrl: string;
  owner: string;
  repo: string;
  ticketId: string;
  slug: string;
  branchName: string;
  baseRef: string | null;
}): TicketBranchRow {
  return {
    id: row.id,
    platform: row.platform === 'GITLAB' ? 'gitlab' : 'github',
    hostUrl: row.hostUrl,
    owner: row.owner,
    repo: row.repo,
    ticketId: row.ticketId,
    slug: row.slug,
    branchName: row.branchName,
    baseRef: row.baseRef,
  };
}
