import path from 'node:path';
import dotenv from 'dotenv';

// Load the monorepo root env before any app code reads process.env. `.env.local`
// is loaded first so its values win — dotenv keeps the first value it sees.
// `.env.local` is materialized by scripts/preflight.ts when a port collides.
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NativeConnection, Worker } from '@temporalio/worker';
import { errorMessage } from '@conduit/shared/runtime';
import * as activities from './activities/index';
import { config } from './config';
import { closeEventBus } from './runtime/event-bus';
import { closePrisma } from './runtime/prisma';
import {
  dockerPreflight,
  resolveAgentAuthMode,
  resolveRunnerEntryPoint,
  resolveRunnerMode,
  sweepOrphanProcessGroups,
  sweepOrphans,
} from './runtime/runner';
import { closeTemporalClient } from './runtime/temporal-client';

async function run(): Promise<void> {
  // Resolved once at boot; throws (and refuses to start) on invalid values
  // or the forbidden hosted+host combination. See runtime/runner/mode.ts.
  const runnerMode = resolveRunnerMode();
  console.log(`[runner] mode: ${runnerMode} (CONDUIT_DEPLOYMENT=${config.deployment})`);

  if (runnerMode === 'docker') {
    // Docker is a hard requirement in this mode — agent execution happens
    // inside per-run agent-runner containers spawned by the worker. Fail
    // fast if Docker isn't reachable, with a message clearer than a silent
    // task-queue stall.
    await dockerPreflight();
    if (resolveAgentAuthMode() === 'oauth-mount') {
      console.warn(
        '[runner] CONDUIT_AGENT_AUTH=oauth-mount active — host ~/.codex/auth.json is bind-mounted into agent containers; do not use in shared/production environments.',
      );
    }
  } else {
    console.warn(
      '[runner] host mode — agent runs execute unsandboxed on this host, as this user, with this environment.',
    );
    // Host counterpart of dockerPreflight: refuse to start when the runner
    // entry point hasn't been built, instead of failing every run at spawn
    // time once activities start landing.
    resolveRunnerEntryPoint();
    if (resolveAgentAuthMode() === 'oauth-mount') {
      console.log(
        '[runner] CONDUIT_AGENT_AUTH=oauth-mount is a no-op in host mode — the runner sees the real $HOME, so ~/.codex/auth.json is reachable without a mount.',
      );
    }
  }

  // Reap runners left behind by a previous worker session — containers
  // labelled with a settled run, and process groups whose pidfile points at
  // one. Both sweeps run regardless of today's mode: orphans belong to
  // whichever mode the *previous* session ran in, and each sweep no-ops
  // cheaply when its substrate is absent (no Docker / no runs root). They're
  // independent, so run them concurrently. Best-effort; never blocks startup.
  await Promise.all(
    [sweepOrphans, sweepOrphanProcessGroups].map((sweep) =>
      sweep().catch((err: unknown) => {
        console.warn('Orphan sweep failed:', errorMessage(err));
      }),
    ),
  );

  const connection = await NativeConnection.connect({ address: config.temporal.address });

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    // Temporal bundles the workflow module via Webpack — it wants a path to a
    // real TS/JS file, not a compiled-output path. In dev (ts-node-dev) and
    // prod (compiled dist) this resolves the same entry point.
    workflowsPath: require.resolve('./workflows/index'),
    activities,
  });

  const shutdown = async (): Promise<void> => {
    worker.shutdown();
    await closeEventBus();
    await closePrisma();
    await closeTemporalClient();
    await connection.close();
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  console.log(
    `Conduit worker listening on task queue "${config.temporal.taskQueue}" (${config.temporal.address})`,
  );
  await worker.run();
}

run().catch((err: unknown) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
