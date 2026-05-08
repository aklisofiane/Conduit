import { describe, expect, it, vi } from 'vitest';

vi.mock('@nestjs/common', () => ({
  Injectable: () => (target: any) => target,
  Logger: class {
    log() {}
    warn() {}
    debug() {}
    error() {}
  },
  NotFoundException: class extends Error {},
  BadRequestException: class extends Error {},
}));

vi.mock('@conduit/database', () => ({
  PrismaClient: class {},
}));

vi.mock('@temporalio/client', () => ({}));

import { WorkflowsService } from '../../src/modules/workflows/workflows.service';

describe('WorkflowsService.list() response shape', () => {
  it('includes _count.runs for each workflow', async () => {
    const mockRows = [
      {
        id: 'wf-1',
        name: 'Deploy',
        description: null,
        definition: {},
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        runs: [
          { id: 'r-1', status: 'COMPLETED', startedAt: new Date(), finishedAt: new Date(), error: null },
        ],
        _count: { runs: 12 },
      },
      {
        id: 'wf-2',
        name: 'Lint',
        description: 'Lint on push',
        definition: {},
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        runs: [],
        _count: { runs: 0 },
      },
    ];

    const prisma = {
      workflow: { findMany: vi.fn().mockResolvedValue(mockRows) },
    };
    const temporal = {};

    const service = new WorkflowsService(prisma as any, temporal as any);
    const result = await service.list();

    expect(prisma.workflow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: { select: { runs: true } },
        }),
      }),
    );

    for (const row of result) {
      expect(row._count).toBeDefined();
      expect(typeof row._count.runs).toBe('number');
    }

    expect(result[0]._count.runs).toBe(12);
    expect(result[1]._count.runs).toBe(0);
  });
});
