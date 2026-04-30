/**
 * Typed mirror of the CSS custom properties declared in `tokens.css`.
 *
 * Use this from places that can't write CSS classes — inline `style={...}`,
 * SVG `stroke` / `fill` attrs, or react-flow props that take literal strings.
 * For everything else (most of the UI), prefer Tailwind utilities or the
 * primitive classes in `globals.css`.
 *
 * Each leaf is a `var(--name)` reference, so the runtime resolution still
 * comes from `tokens.css` — swap the CSS file and the whole TS surface
 * follows automatically.
 */

import type { AgentConfig } from '@conduit/shared';

const v = (name: string) => `var(${name})`;

export const tokens = {
  font: {
    sans: v('--font-sans'),
    mono: v('--font-mono'),
  },
  color: {
    bg: v('--color-bg'),
    bgPanel: v('--color-bg-panel'),
    bgCanvas: v('--color-bg-canvas'),
    text: v('--color-text'),
    text2: v('--color-text-2'),
    textMuted: v('--color-text-muted'),
    divider: v('--color-divider'),
    edge: v('--color-edge'),
    success: v('--color-success'),
    running: v('--color-running'),
    warn: v('--color-warn'),
    error: v('--color-error'),
    accent: v('--color-accent'),
    accentSoft: v('--color-accent-soft'),
    primary: v('--color-primary'),
    primaryText: v('--color-primary-text'),
    primaryBorder: v('--color-primary-border'),
    pillBg: v('--color-pill-bg'),
    pillBorder: v('--color-pill-border'),
    footerBg: v('--color-footer-bg'),
    trigger: v('--color-trigger'),
    triggerBg: v('--color-trigger-bg'),
    triggerBorder: v('--color-trigger-border'),
  },
  provider: {
    claude: {
      mark: v('--color-claude-mark'),
      card: v('--color-claude-card'),
      prompt: v('--color-claude-prompt'),
      promptBorder: v('--color-claude-prompt-border'),
      footer: v('--color-claude-footer'),
      border: v('--color-claude-border'),
      tagBg: v('--color-claude-tag-bg'),
      tagText: v('--color-claude-tag-text'),
    },
    codex: {
      mark: v('--color-codex-mark'),
      card: v('--color-codex-card'),
      prompt: v('--color-codex-prompt'),
      promptBorder: v('--color-codex-prompt-border'),
      footer: v('--color-codex-footer'),
      border: v('--color-codex-border'),
      tagBg: v('--color-codex-tag-bg'),
      tagText: v('--color-codex-tag-text'),
    },
  },
  radius: {
    sm: v('--radius-sm'),
    md: v('--radius'),
    lg: v('--radius-md'),
  },
  shadow: {
    node: v('--shadow-node'),
    focus: v('--shadow-focus'),
  },
  canvas: {
    gridColor: v('--canvas-grid-color'),
    gridSize: v('--canvas-grid-size'),
  },
} as const;

export type ProviderId = AgentConfig['provider'];

export type ProviderStyle = (typeof tokens.provider)[ProviderId];

export function providerStyle(provider: ProviderId): ProviderStyle {
  return tokens.provider[provider];
}

/**
 * Node geometry shared between the renderer and any code that needs to know
 * a node's logical size (e.g. layout heuristics, drop-position rounding).
 */
export const nodeSize = {
  agent: { width: 230, minHeight: 168 },
  trigger: { width: 140, minHeight: 56 },
} as const;
