import { NotFoundException } from '@nestjs/common';

/**
 * Collapse the ubiquitous "lookup → 404 if missing" pattern into one
 * expression with a consistent message shape (`<Resource> <id> not found`).
 * Works with any lookup result (org-scoped `findFirst`, `findUnique`, etc.) —
 * it only owns the not-found decision, not the query.
 *
 *   return orNotFound(
 *     await this.prisma.workflow.findFirst({ where: { id, orgId } }),
 *     'Workflow', id,
 *   );
 */
export function orNotFound<T>(row: T | null | undefined, resource: string, id: string): T {
  if (row == null) throw new NotFoundException(`${resource} ${id} not found`);
  return row;
}
