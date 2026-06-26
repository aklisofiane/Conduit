import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyConduitFilesActivity } from './copy-conduit-files';

/**
 * `copyConduitFilesActivity` carries each parallel sibling's
 * `.conduit/<Node>.md` summary into the merged upstream workspace after a
 * merge-back. `.conduit/` is gitignored so the git merge never carries it —
 * a silent regression here means downstream nodes lose every sibling's
 * context. The agent-workflow integration test stubs this activity out
 * entirely, so the small load-bearing contract is pinned here: the
 * empty-sources guard, heartbeat-before-copy ordering, and the exact
 * system-log message formatting (including the '(none)' fallback).
 *
 * Only @conduit/agent (touchWorktreeHeartbeat/copyConduitSummaries) and the
 * log writer are mocked; no real filesystem or infra.
 */

const { touchWorktreeHeartbeat, copyConduitSummaries, writeSystemLog } = vi.hoisted(() => ({
  touchWorktreeHeartbeat: vi.fn(),
  copyConduitSummaries: vi.fn(),
  writeSystemLog: vi.fn(),
}));

vi.mock('@conduit/agent', () => ({ touchWorktreeHeartbeat, copyConduitSummaries }));
vi.mock('../runtime/log-writer', () => ({ writeSystemLog }));

const baseInput = {
  runId: 'run_1',
  orgId: 'org_1',
  targetWorkspacePath: '/workspaces/merged-upstream',
  targetNodeName: 'Merge',
};

describe('copyConduitFilesActivity', () => {
  beforeEach(() => {
    touchWorktreeHeartbeat.mockResolvedValue(undefined);
    copyConduitSummaries.mockResolvedValue([]);
    writeSystemLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('short-circuits on empty sources: no heartbeat, no copy, no log', async () => {
    await expect(
      copyConduitFilesActivity({ ...baseInput, sources: [] }),
    ).resolves.toBeUndefined();

    expect(touchWorktreeHeartbeat).not.toHaveBeenCalled();
    expect(copyConduitSummaries).not.toHaveBeenCalled();
    expect(writeSystemLog).not.toHaveBeenCalled();
  });

  it('heartbeats the target worktree before copying summaries', async () => {
    const sources = [{ nodeName: 'A', workspacePath: '/workspaces/a' }];
    const order: string[] = [];
    touchWorktreeHeartbeat.mockImplementation(async () => {
      order.push('heartbeat');
    });
    copyConduitSummaries.mockImplementation(async () => {
      order.push('copy');
      return [];
    });

    await copyConduitFilesActivity({ ...baseInput, sources });

    expect(touchWorktreeHeartbeat).toHaveBeenCalledWith('/workspaces/merged-upstream');
    expect(order).toEqual(['heartbeat', 'copy']);
  });

  it('copies from sources into the target and logs the joined filenames', async () => {
    const sources = [
      { nodeName: 'Fix', workspacePath: '/workspaces/fix' },
      { nodeName: 'Doc', workspacePath: '/workspaces/doc' },
    ];
    copyConduitSummaries.mockResolvedValue(['Fix.md', 'Doc.md']);

    await copyConduitFilesActivity({ ...baseInput, sources });

    expect(copyConduitSummaries).toHaveBeenCalledWith(sources, '/workspaces/merged-upstream');
    expect(writeSystemLog).toHaveBeenCalledWith(
      'run_1',
      'org_1',
      'Merge',
      'copied .conduit/ summaries: Fix.md, Doc.md',
    );
  });

  it("falls back to '(none)' when no summaries were copied", async () => {
    const sources = [{ nodeName: 'A', workspacePath: '/workspaces/a' }];
    copyConduitSummaries.mockResolvedValue([]);

    await copyConduitFilesActivity({ ...baseInput, sources });

    expect(writeSystemLog).toHaveBeenCalledWith(
      'run_1',
      'org_1',
      'Merge',
      'copied .conduit/ summaries: (none)',
    );
  });
});
