/**
 * codex-token-usage-check.ts
 *
 * Standalone diagnostic: drive `@openai/codex-sdk` directly and inspect the
 * token usage it reports, then replay Conduit's exact mapping + accumulation +
 * cost logic on top of it to confirm we're aligned.
 *
 * Two scenarios:
 *   A) one thread, one turn  — "Hello"
 *   B) one thread, two turns — "Hello" then "How are you?"
 *
 * What we're checking:
 *   1. Which usage fields the SDK actually populates per turn
 *      (input_tokens / cached_input_tokens / output_tokens / reasoning_output_tokens).
 *   2. Whether per-turn `input_tokens` is cumulative across the thread
 *      (i.e. turn 2 re-bills turn 1's history) — this is what determines
 *      whether summing per-turn usage is the "right" run total.
 *   3. Whether Conduit's mapping (codex-provider.ts `turn.completed` handler)
 *      and accumulation (run-agent-node.ts `onAgentEvent`) reproduce the same
 *      numbers — and what we drop on the floor (cached + reasoning tokens).
 *
 * Run:
 *   OPENAI_API_KEY=sk-... npx tsx scripts/codex-token-usage-check.ts
 *   # optional: CODEX_MODEL=gpt-5.3-codex  CODEX_BASE_URL=...
 *
 * Auth: the codex SDK shells out to the `codex` CLI. It picks up
 * OPENAI_API_KEY, or an existing ChatGPT login (`codex login`). No Conduit
 * infra (DB/Temporal/Docker) is touched.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ThreadEvent, Usage } from '@openai/codex-sdk';
import { resolveModelPrice } from '@conduit/shared/agent';

// ESM-only package with no `require` condition — load it the way the provider
// does (dynamic import) so tsx doesn't try to CJS-resolve it.
const { Codex } = await import('@openai/codex-sdk');

const MODEL = process.env.CODEX_MODEL ?? 'gpt-5.5';
const BASE_URL = process.env.CODEX_BASE_URL;
const API_KEY = process.env.OPENAI_API_KEY;

// ── Conduit's exact mapping, copied verbatim from codex-provider.ts so the
//    comparison reflects what production actually records (not what the SDK
//    reports). Only input_tokens / output_tokens survive the translate step.
function conduitMapTurn(usage: Usage): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  };
}

// run-agent-node.ts onAgentEvent: sum the per-turn `usage` events.
function conduitAccumulate(turns: Usage[]): {
  inputTokens: number;
  outputTokens: number;
  turns: number;
} {
  const acc = { inputTokens: 0, outputTokens: 0, turns: 0 };
  for (const u of turns) {
    const mapped = conduitMapTurn(u);
    acc.inputTokens += mapped.inputTokens;
    acc.outputTokens += mapped.outputTokens;
    acc.turns += 1;
  }
  return acc;
}

// run-agent-node.ts snapshot-at-write cost.
function conduitCost(inputTokens: number, outputTokens: number) {
  const price = resolveModelPrice(MODEL);
  if (!price) return { costUsd: undefined, price: null };
  const costUsd =
    (inputTokens / 1_000_000) * price.inputPerM + (outputTokens / 1_000_000) * price.outputPerM;
  return { costUsd, price };
}

/** Run N turns on one fresh thread; return the per-turn Usage objects. */
async function runScenario(label: string, prompts: string[]): Promise<Usage[]> {
  console.log(`\n${'═'.repeat(72)}\n▶ Scenario ${label}: ${prompts.length} turn(s) — ${prompts
    .map((p) => JSON.stringify(p))
    .join(' → ')}\n${'═'.repeat(72)}`);

  const codex = new Codex({
    ...(API_KEY ? { apiKey: API_KEY } : {}),
    ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
  });

  const thread = codex.startThread({
    model: MODEL,
    workingDirectory: mkdtempSync(join(tmpdir(), 'codex-usage-')),
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    skipGitRepoCheck: true,
  });

  const perTurn: Usage[] = [];

  for (const [i, prompt] of prompts.entries()) {
    // Mirror codex-provider: prepend a tiny system block on the first turn
    // only, so input-token accounting matches what production would send.
    const input = i === 0 ? `<system>\nYou are a terse assistant.\n</system>\n\n${prompt}` : prompt;

    const { events } = await thread.runStreamed(input);
    let text = '';
    for await (const raw of events as AsyncIterable<ThreadEvent>) {
      if (raw.type === 'item.completed' && raw.item.type === 'agent_message') {
        text = raw.item.text;
      }
      if (raw.type === 'turn.completed') {
        perTurn.push(raw.usage);
        const u = raw.usage;
        console.log(
          `\n  Turn ${i + 1} reply: ${JSON.stringify(text.slice(0, 80))}` +
            `\n  Turn ${i + 1} raw SDK usage:` +
            `\n    input_tokens            = ${u.input_tokens}` +
            `\n    cached_input_tokens     = ${u.cached_input_tokens}   (Conduit DROPS this)` +
            `\n    output_tokens           = ${u.output_tokens}` +
            `\n    reasoning_output_tokens = ${u.reasoning_output_tokens}   (subset of output_tokens)`,
        );
      }
      if (raw.type === 'turn.failed') {
        throw new Error(`turn ${i + 1} failed: ${raw.error.message}`);
      }
    }
  }

  return perTurn;
}

function reportConduitView(label: string, turns: Usage[]) {
  const acc = conduitAccumulate(turns);
  const { costUsd, price } = conduitCost(acc.inputTokens, acc.outputTokens);

  // What the cost WOULD be if we billed cached input at the typical 90%-off
  // rate (OpenAI prompt-caching discount) instead of full price.
  const cachedTotal = turns.reduce((s, u) => s + (u.cached_input_tokens ?? 0), 0);

  console.log(
    `\n  ── Conduit-recorded view (${label}) ──` +
      `\n    usage.inputTokens  = ${acc.inputTokens}   (Σ per-turn input_tokens)` +
      `\n    usage.outputTokens = ${acc.outputTokens}   (Σ per-turn output_tokens)` +
      `\n    usage.turns        = ${acc.turns}` +
      `\n    price (${MODEL})    = ${
        price ? `$${price.inputPerM}/M in, $${price.outputPerM}/M out [${price.source}]` : 'UNKNOWN MODEL → no cost'
      }` +
      `\n    costUsd            = ${costUsd === undefined ? 'undefined' : `$${costUsd.toFixed(6)}`}` +
      `\n    cached input seen  = ${cachedTotal} tokens — billed at FULL input rate today` +
      (cachedTotal > 0 && price
        ? ` (≈ $${(((cachedTotal / 1_000_000) * price.inputPerM) * 0.9).toFixed(6)} potential overcharge vs 90%-off caching)`
        : ''),
  );
}

async function main() {
  if (!API_KEY) {
    console.log(
      'ℹ No OPENAI_API_KEY set — relying on an existing `codex login`. If the SDK errors on auth, set OPENAI_API_KEY.',
    );
  }
  console.log(`Model under test: ${MODEL}${BASE_URL ? `  (baseUrl=${BASE_URL})` : ''}`);

  const a = await runScenario('A', ['Hello']);
  reportConduitView('A', a);

  const b = await runScenario('B', ['Hello', 'How are you?']);
  reportConduitView('B', b);

  // A third, deliberately tiny turn. Each new turn adds only a handful of
  // content tokens, so the SHAPE of input_tokens across turns disambiguates:
  //   • per-turn (per-API-call) counts → roughly FLAT  (n, n, n)
  //   • cumulative session totals      → roughly LINEAR (n, 2n, 3n)
  const c = await runScenario('C', ['Hello', 'How are you?', 'Thanks!']);
  reportConduitView('C', c);

  // ── Alignment verdict ──────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(72)}\n▶ Alignment checks\n${'═'.repeat(72)}`);

  // Decisive test: is per-turn usage cumulative or per-call?
  const seq = c.map((u) => u.input_tokens);
  const base = seq[0] ?? 0;
  // cumulative ⇒ turn k ≈ k × base; per-call ⇒ turn k ≈ base.
  const cumulativeFit =
    seq.length >= 2 && seq.every((v, k) => Math.abs(v - (k + 1) * base) < 0.25 * base);
  const flatFit = seq.length >= 2 && seq.every((v) => Math.abs(v - base) < 0.25 * base);

  console.log(
    `\n  input_tokens sequence (3-turn run C): ${seq.join(' → ')}` +
      `\n  expected if CUMULATIVE (×k):           ${seq.map((_, k) => (k + 1) * base).join(' → ')}` +
      `\n  expected if PER-CALL (flat):           ${seq.map(() => base).join(' → ')}` +
      `\n  → verdict: ${
        cumulativeFit
          ? 'CUMULATIVE — each turn.completed reports the running session total'
          : flatFit
            ? 'PER-CALL — each turn.completed reports only that call'
            : 'INCONCLUSIVE — inspect the numbers manually'
      }`,
  );

  if (cumulativeFit) {
    const conduitSum = seq.reduce((s, v) => s + v, 0);
    const correctTotal = seq[seq.length - 1] ?? 0;
    console.log(
      `\n  ⚠ BUG: Conduit's onAgentEvent SUMS each turn's usage, but codex emits` +
        `\n    cumulative totals. So the run total double-counts every prior turn.` +
        `\n      Conduit would record input = Σ = ${conduitSum}` +
        `\n      Correct run total          = last cumulative = ${correctTotal}` +
        `\n      Overcount factor           ≈ ${(conduitSum / correctTotal).toFixed(2)}×` +
        `\n    Fix: codex-provider should emit per-turn DELTAS (current − previous)` +
        `\n    so the downstream summation lands on the final cumulative value` +
        `\n    — OR run-agent-node should take the last codex usage, not the sum.`,
    );
  }

  const allTurns = [...a, ...b, ...c];
  const droppedCached = allTurns.some((u) => (u.cached_input_tokens ?? 0) > 0);
  const droppedReasoning = allTurns.some((u) => (u.reasoning_output_tokens ?? 0) > 0);
  console.log(
    `\n  Separately, Conduit maps only input_tokens + output_tokens:` +
      `\n    cached_input_tokens populated?     ${droppedCached ? 'YES → dropped (cached input billed at full rate)' : 'no'}` +
      `\n    reasoning_output_tokens populated? ${
        droppedReasoning ? 'YES → folded into output_tokens (output rate, OK)' : 'no'
      }`,
  );
  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error('\n✗ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
