import fs from 'node:fs/promises';
import path from 'node:path';
import { MockActivityEnvironment, TestWorkflowEnvironment } from '@temporalio/testing';
import { workflowDefinitionSchema, type WorkflowDefinition } from '@conduit/shared';

/**
 * Shared helpers for Temporal-level tests. Wraps `@temporalio/testing` so
 * test files don't import it directly, and exposes fixture loaders alongside.
 */

/**
 * Time-skipping workflow environment. Sleeps, retry backoffs, and schedule
 * intervals are fast-forwarded; activities imported from the worker run for
 * real.
 */
export async function createTestWorkflowEnv(): Promise<TestWorkflowEnvironment> {
  return TestWorkflowEnvironment.createTimeSkipping();
}

/**
 * Build a fresh `MockActivityEnvironment`. Optional heartbeat subscriber is
 * wired to the emitter so tests can assert on heartbeat payloads without
 * manually hooking the event each time.
 */
export function createActivityEnv(
  heartbeatSubscriber?: (details: unknown) => void,
): MockActivityEnvironment {
  const env = new MockActivityEnvironment();
  if (heartbeatSubscriber) env.on('heartbeat', heartbeatSubscriber);
  return env;
}

const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');

/**
 * Load and parse a workflow fixture. Returns the full JSON shape including
 * `name` / `description` / `definition`. The definition is validated against
 * the same Zod schema the API uses, so fixtures that drift from the schema
 * fail loudly at test start instead of mid-run.
 */
export interface WorkflowFixture {
  name: string;
  description?: string;
  definition: WorkflowDefinition;
}

export async function loadWorkflowFixture(name: string): Promise<WorkflowFixture> {
  const file = path.join(FIXTURES_DIR, 'workflows', `${name}.json`);
  const raw = await fs.readFile(file, 'utf8');
  const parsed = JSON.parse(raw) as { name?: unknown; description?: unknown; definition: unknown };
  if (typeof parsed.name !== 'string') {
    throw new Error(`Fixture ${name}: missing top-level "name" string`);
  }
  return {
    name: parsed.name,
    description: typeof parsed.description === 'string' ? parsed.description : undefined,
    definition: workflowDefinitionSchema.parse(parsed.definition),
  };
}

/** Absolute path to the tiny stdio MCP stub server. */
export const MCP_STUB_SERVER_PATH = path.join(FIXTURES_DIR, 'mcp-stub', 'server.mjs');
