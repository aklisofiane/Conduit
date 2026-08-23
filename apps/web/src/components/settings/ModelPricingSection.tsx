import { useEffect, useState } from 'react';
import { MODEL_PRICING, PROVIDER_MODELS } from '@conduit/shared/agent';
import type { ModelPriceRow } from '../../api/types.js';
import { useDeleteModelPrice, useModelPrices, useUpsertModelPrice } from '../../api/hooks.js';
import { apiErrorMessage } from '../../api/client.js';
import { relativeFromNow } from '../../lib/time.js';
import { SettingsSection } from '../common/SettingsSection.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';

/** [provider, model] pairs in display order, deduped across providers. */
const MODEL_ROWS: Array<{ provider: string; model: string }> = Object.entries(PROVIDER_MODELS)
  .flatMap(([provider, models]) => models.map((model) => ({ provider, model })))
  .filter((row, i, all) => all.findIndex((r) => r.model === row.model) === i);

/**
 * Per-org per-model price overrides ($ per 1M tokens). One row per known model;
 * a blank field shows the shipped `MODEL_PRICING` default as placeholder and
 * leaves that model on the default. Saving writes an override; "Reset" clears it
 * (DELETE) back to the default. Costs snapshot the resolved price at run time,
 * so edits here only affect future runs.
 */
export function ModelPricingSection() {
  const { data: overrides = [], isLoading } = useModelPrices();
  const byModel = new Map(overrides.map((row) => [row.model, row]));

  return (
    <SettingsSection
      title="Model pricing"
      description="Per-org $ per 1M tokens, overriding the shipped defaults. Blank = default. Edits apply to future runs only — completed runs keep the price they were charged at."
    >
      <div className="grid grid-cols-[1fr_120px_120px_auto] items-center gap-4 border-b border-[var(--color-divider)] px-4 py-2">
        <span className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
          Model
        </span>
        <span className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
          Input $/1M
        </span>
        <span className="font-mono text-caption uppercase tracking-wide text-[var(--color-text-muted)]">
          Output $/1M
        </span>
        <span />
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center justify-center font-mono text-small text-[var(--color-text-muted)]">
          Loading…
        </div>
      ) : (
        MODEL_ROWS.map(({ model }) => (
          <ModelPriceRowView key={model} model={model} override={byModel.get(model)} />
        ))
      )}
    </SettingsSection>
  );
}

function ModelPriceRowView({
  model,
  override,
}: {
  model: string;
  override: ModelPriceRow | undefined;
}) {
  const def = MODEL_PRICING[model];
  const upsert = useUpsertModelPrice();
  const del = useDeleteModelPrice();

  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Re-seed the fields from the server row whenever the override changes (after
  // a save/reset invalidation), so the inputs reflect the persisted state.
  useEffect(() => {
    setInput(override ? String(override.inputPerM) : '');
    setOutput(override ? String(override.outputPerM) : '');
    setError(null);
  }, [override?.inputPerM, override?.outputPerM]);

  const inputNum = input.trim() === '' ? null : Number(input);
  const outputNum = output.trim() === '' ? null : Number(output);
  const valid =
    inputNum !== null &&
    outputNum !== null &&
    Number.isFinite(inputNum) &&
    Number.isFinite(outputNum) &&
    inputNum >= 0 &&
    outputNum >= 0;

  const dirty =
    input !== (override ? String(override.inputPerM) : '') ||
    output !== (override ? String(override.outputPerM) : '');

  const handleSave = async () => {
    if (!valid || inputNum === null || outputNum === null) return;
    setError(null);
    try {
      await upsert.mutateAsync({ model, inputPerM: inputNum, outputPerM: outputNum });
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const handleReset = async () => {
    setError(null);
    try {
      await del.mutateAsync(model);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  return (
    <div className="grid grid-cols-[1fr_120px_120px_auto] items-center gap-4 border-b border-[var(--color-divider)] px-4 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate font-mono text-small font-medium text-[var(--color-text)]">
          {model}
        </div>
        <div className="font-mono text-caption text-[var(--color-text-muted)]">
          {override ? `overridden · ${relativeFromNow(override.updatedAt)}` : 'default'}
        </div>
        {error && (
          <div className="mt-1 font-mono text-caption text-[var(--color-danger)]">{error}</div>
        )}
      </div>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        aria-label={`${model} input price per 1M tokens`}
        placeholder={def ? String(def.inputPerM) : '—'}
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        aria-label={`${model} output price per 1M tokens`}
        placeholder={def ? String(def.outputPerM) : '—'}
        value={output}
        onChange={(e) => setOutput(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={!valid || !dirty || upsert.isPending}
          onClick={handleSave}
        >
          {upsert.isPending ? 'Saving…' : 'Save'}
        </Button>
        {override && (
          <Button disabled={del.isPending} onClick={handleReset}>
            {del.isPending ? 'Resetting…' : 'Reset'}
          </Button>
        )}
      </div>
    </div>
  );
}
