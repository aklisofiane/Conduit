import { ApiKeysSection } from '../components/settings/ApiKeysSection.js';

/**
 * `/settings/api-keys` — per-org provider API keys (Anthropic, OpenAI). The
 * agent runtime reads these directly; the worker falls back to env defaults
 * when a row is missing.
 */
export function ApiKeysPage() {
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 pb-16 pt-10">
      <h1
        className="text-[34px] font-semibold leading-none tracking-tight text-[var(--color-text)]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        API keys<em className="text-[var(--color-claude-mark)] not-italic">.</em>
      </h1>
      <p className="font-mono text-[12px] text-[var(--color-text-2)]">
        Per-org provider keys consumed by the agent runtime. Set keys here to override the worker's env defaults — useful for LiteLLM / OpenAI-compatible proxies.
      </p>

      <ApiKeysSection />
    </div>
  );
}
