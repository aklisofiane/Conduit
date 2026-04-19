import type { TicketBranchRow, TicketBranchStore } from '@conduit/agent';
import { deriveSlug, formatBranchName } from '@conduit/agent';
import { prisma } from './prisma';

/**
 * `TicketBranchStore` backed by the Prisma `TicketBranch` model. Owns the
 * slug derivation on first create so the workspace manager never guesses a
 * different slug than the one persisted.
 *
 * Shared across workflows — the unique key is
 * `(platform, owner, repo, ticketId)`, so a Worker and a Critic pointing
 * at the same ticket always converge on the same row.
 */
export function makeTicketBranchStore(): TicketBranchStore {
  return {
    async upsert(input) {
      const platform = input.platform === 'github' ? 'GITHUB' : 'GITLAB';
      const existing = await prisma().ticketBranch.findUnique({
        where: {
          platform_owner_repo_ticketId: {
            platform,
            owner: input.owner,
            repo: input.repo,
            ticketId: input.ticketId,
          },
        },
      });
      if (existing) {
        return toRow(existing);
      }
      const slug = deriveSlug(input.ticketTitle);
      const branchName = formatBranchName(input.ticketId, slug);
      const created = await prisma().ticketBranch.create({
        data: {
          platform,
          owner: input.owner,
          repo: input.repo,
          ticketId: input.ticketId,
          slug,
          branchName,
          baseRef: input.baseRef,
        },
      });
      return toRow(created);
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
    owner: row.owner,
    repo: row.repo,
    ticketId: row.ticketId,
    slug: row.slug,
    branchName: row.branchName,
    baseRef: row.baseRef,
  };
}
