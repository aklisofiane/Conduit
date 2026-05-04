import { createHmac } from 'node:crypto';
import { expect } from 'vitest';
import type { Harness } from '../e2e/harness';

/**
 * Helpers for E2E tests that drive the API by simulating an inbound webhook
 * delivery. Mirrors what GitHub does on the wire: stringify the payload
 * once, sign those exact bytes, POST with the standard delivery headers.
 */

/** `sha256=…` header value, computed over the exact bytes you'll POST. */
export function signGithubBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export interface DeliverGithubWebhookOptions {
  /** GitHub event name, e.g. `'issues'`, `'pull_request'`. */
  event: string;
  /** Unique-per-test delivery id; surfaces in API logs as `X-GitHub-Delivery`. */
  deliveryId: string;
  /** HMAC secret matching the `webhookSecret` on the workflow's connection. */
  secret: string;
  /** Parsed JSON payload — re-stringified here so the signature matches. */
  payload: unknown;
}

/**
 * POST a signed GitHub webhook to `/api/hooks/:workflowId`, assert 200 +
 * `started`, and return the new run id. Centralizes the HMAC signing and
 * header set so individual phase tests don't re-derive them.
 */
export async function deliverGithubWebhook(
  harness: Harness,
  workflowId: string,
  opts: DeliverGithubWebhookOptions,
): Promise<{ status: string; runId: string }> {
  const body = JSON.stringify(opts.payload);
  const res = await fetch(`${harness.apiUrl}/api/hooks/${workflowId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': opts.event,
      'X-GitHub-Delivery': opts.deliveryId,
      'X-Hub-Signature-256': signGithubBody(opts.secret, body),
    },
    body,
  });
  expect(res.status).toBe(200);
  const result = (await res.json()) as { status: string; runId?: string };
  expect(result.status).toBe('started');
  expect(result.runId).toBeDefined();
  return { status: result.status, runId: result.runId! };
}

/**
 * Poll a fetcher until `ready(value)` returns true or the deadline passes.
 * Used by E2E tests to wait for run-status transitions that arrive on a
 * later Temporal activity than the WS `done` frame.
 */
export async function pollForStatus<T>(
  fetcher: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fetcher();
    if (ready(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out after ${timeoutMs}ms. Last value: ${JSON.stringify(last)}`);
}
