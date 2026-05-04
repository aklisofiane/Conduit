# Design

Visual tokens for the web app. Read [FRONTEND.md](./FRONTEND.md) for screen structure first; this doc is the token layer underneath.

## Three layers

| Layer | File | Role |
|---|---|---|
| CSS variables | `apps/web/src/styles/tokens.css` | Source of truth. All colors, fonts, radii, shadows, canvas grid live here under `:root`. |
| Tailwind `@theme` | `apps/web/src/styles/globals.css` | Bridge — **fonts only**. Maps `--font-sans/-mono/-serif` so `font-sans` / `font-mono` Tailwind utilities resolve. Nothing else is bridged. |
| TS mirror | `apps/web/src/styles/theme.ts` | `tokens` const + `providerStyle()` for inline `style={{}}` use in canvas components. |

### Why two consumption styles

Tailwind utilities for typography (`font-sans`, `font-mono`) — only because of the `@theme` font block. Everything else is consumed via:

- **Arbitrary Tailwind values** like `bg-[var(--color-bg-panel)]`, `rounded-[var(--radius)]`, `border-[var(--color-divider)]` — used in shell/layout (`TopChrome`, `AgentConfigPanel`).
- **TS `tokens` import** with inline `style` — used in canvas nodes (`AgentNode`, `NodePalette`, `TriggerNode`) where colors derive from runtime data (e.g., per-provider).

There is intentionally **no Tailwind `@theme` mapping for colors or radii**. Doubling tokens into the Tailwind config was tried and dropped — every consumer already uses `[var(...)]` syntax, and the `@theme inline` block has no other entries. Don't reintroduce one.

## Palette

Light, warm-paper base. Source: `apps/web/src/styles/tokens.css:1-67`.

- **Surfaces** — `--color-bg #fcfbf8`, `--color-bg-panel #fcfbf8`, `--color-bg-canvas #fbfaf6`
- **Text** — `--color-text #0b1020`, `--color-text-2 #3b475c`, `--color-text-muted #8a93a6`
- **Lines** — `--color-divider #e8e5dd`, `--color-edge #a8afbe` (React Flow edges)
- **Status** — oklch: `--color-success` (green), `--color-running` (blue), `--color-warn` (amber), `--color-error` (red)
- **Accent / primary** — oklch blue family (`--color-accent`, `--color-primary`, `--color-accent-soft`)
- **Trigger** — neutral cool family (`--color-trigger`, `-bg`, `-border`)

### Per-provider families

Two warm/cool families, namespaced by provider key:

| Variable suffix | Claude (warm amber) | Codex (cool teal-green) |
|---|---|---|
| `-mark` | the glyph background (saturated) | same role |
| `-card` | node card body (very pale tint) | same |
| `-prompt` | inner prompt sheet | same |
| `-prompt-border`, `-border` | borders | same |
| `-footer` | node footer band | same |
| `-tag-bg`, `-tag-text` | uppercase tag pill | same |

Hue: Claude ≈ `oklch(... 50)` (amber), Codex ≈ `oklch(... 155)` (green-teal).

### Legacy aliases

`tokens.css:57-67` defines `--color-claude`, `--color-codex`, `--color-bg-1..3`, `--color-line`, `--color-line-2`, `--color-text-3`, `--color-text-4`. These exist only for older pages (Home, Credentials, Connections, Runs, TemplatePicker) that haven't migrated to the canvas palette. Drop once those pages are restyled. Don't add new consumers.

## Radii, shadows, grid

```
--radius-sm  4px      tokens.radius.sm   (small pills, tags, field inputs)
--radius     6px      tokens.radius.md   (default — node cards, buttons, nav icons)
--radius-md  7px      (Tailwind arbitrary only — agent palette card)
--radius-lg  8px      tokens.radius.lg   (larger surfaces)
--shadow-node         tokens.shadow.node   (1px hairline shadow on nodes)
--shadow-focus        tokens.shadow.focus  (3px accent ring)
--canvas-grid-color, --canvas-grid-size    React Flow background dot grid
```

Note: `tokens.radius.md` maps to `--radius` (6px), not `--radius-md` (7px). The intermediate 7px value is reachable only via Tailwind arbitrary syntax (`rounded-[var(--radius-md)]`), and is currently used by the agent palette card to read slightly chunkier than node bodies.

## Provider tokens — single carrier

`tokens.provider.{claude, codex}` (`apps/web/src/styles/theme.ts:35-60`) is the **one place** that knows about a provider. Each entry carries:

```ts
{
  mark, card, prompt, promptBorder, footer, border, tagBg, tagText,  // colors
  font: var('--font-sans' | '--font-mono'),                          // display font
  label: 'Claude' | 'Codex',                                         // human label
}
```

Consumers call `providerStyle(provider)` and read `ps.font` / `ps.label` directly. The previous pattern of inline `provider === 'codex' ? mono : sans` ternaries and `provider === 'codex' ? 'Codex' : 'Claude'` mappings was removed from `AgentNode`, `NodePalette`, and `AgentConfigPanel`.

**Adding a third provider** is a one-entry change to `tokens.provider` plus matching CSS variables in `tokens.css`. No call-site edits.

## `nodeSize`

Fixed agent/trigger node dimensions, exported from `theme.ts:84-87`:

```ts
nodeSize.agent   = { width: 230, minHeight: 168 }
nodeSize.trigger = { width: 140, minHeight: 56 }
```

Read by `AgentNode` / `TriggerNode` for the outer wrapper; React Flow uses these to lay out edges.

## Consumer map

| Component | Pulls |
|---|---|
| `AgentNode` (`canvas/AgentNode.tsx`) | `providerStyle()` for all provider colors + `ps.font` for header/prompt; `tokens.color`, `tokens.shadow`, `nodeSize` |
| `NodePalette` (`canvas/NodePalette.tsx`) | `providerStyle()` for agent cards (`ps.font`, `ps.mark`, `ps.card`, `ps.border`); `tokens.color.trigger*` for the trigger card |
| `AgentConfigPanel` (`canvas/AgentConfigPanel.tsx`) | `providerStyle()` for the heading dot + `ps.label` text; arbitrary-`var` Tailwind for the rest |
| `TriggerNode`, `TriggerConfigPanel` (`canvas/`) | `tokens.color.trigger*` only (trigger is not provider-specific) |
| `TopChrome` (`layout/TopChrome.tsx`) | Arbitrary-`var` Tailwind only — divider, panel bg, accent for the logo, pill bg for nav-icon hover |
| Component primitives in `globals.css` | `.btn`, `.chip`, `.pill`, `.field-input`, `.kbd`, `.status-dot`, `.prov-glyph` — read CSS vars directly |

## `cn()` helper

`apps/web/src/lib/cn.ts` — thin `clsx` wrapper:

```ts
export const cn = (...inputs: ClassValue[]): string => clsx(inputs);
```

Use it where conditional Tailwind classes meet `var(...)` arbitrary values — e.g. `TopChrome` `NavIconLink:65-71` toggles active/inactive class strings, both of which contain `[var(--color-...)]`.
