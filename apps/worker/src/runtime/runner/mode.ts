/**
 * Where agent runs execute:
 *
 *   - `docker`: per-run `agent-runner` containers (the trust boundary that
 *               makes multi-tenant hosting possible).
 *   - `host`:   detached child processes on the worker's own machine, with
 *               the user's real environment ($HOME, PATH, toolchains).
 *               Explicitly unsandboxed — the local trust model is "agent
 *               acting as the user on their machine", same as running
 *               Claude Code or Codex CLI directly.
 *
 * Resolution table (`CONDUIT_DEPLOYMENT` × `CONDUIT_RUNNER_MODE`):
 *
 *   | deployment        | runner mode       | result        |
 *   |-------------------|-------------------|---------------|
 *   | `local` (default) | unset             | host          |
 *   | `local`           | `docker`          | docker        |
 *   | `local`           | `host`            | host          |
 *   | `hosted`          | unset or `docker` | docker        |
 *   | `hosted`          | `host`            | boot failure  |
 *   | any               | anything else     | boot failure  |
 *
 * `hosted`+`host` refuses to start rather than silently downgrading —
 * mirroring the `CONDUIT_AGENT_AUTH=oauth-mount` precedent: trust-boundary
 * relaxation is explicit, logged, and impossible when hosted.
 */
export type RunnerMode = 'docker' | 'host';

export function resolveRunnerMode(): RunnerMode {
  // Empty string counts as unset — `.env.example` ships `VAR=""` placeholders.
  const deployment = orUnset(process.env.CONDUIT_DEPLOYMENT) ?? 'local';
  if (deployment !== 'local' && deployment !== 'hosted') {
    throw new Error(
      `CONDUIT_DEPLOYMENT must be 'local' or 'hosted' (got "${deployment}")`,
    );
  }

  const mode = orUnset(process.env.CONDUIT_RUNNER_MODE);
  if (mode !== undefined && mode !== 'docker' && mode !== 'host') {
    throw new Error(
      `CONDUIT_RUNNER_MODE must be 'docker' or 'host' (got "${mode}")`,
    );
  }

  if (deployment === 'hosted') {
    if (mode === 'host') {
      throw new Error(
        "CONDUIT_RUNNER_MODE=host is not allowed when CONDUIT_DEPLOYMENT=hosted — host mode runs agents unsandboxed on the worker machine. Unset CONDUIT_RUNNER_MODE (or set it to 'docker').",
      );
    }
    return 'docker';
  }

  return mode ?? 'host';
}

function orUnset(value: string | undefined): string | undefined {
  return value === '' ? undefined : value;
}
