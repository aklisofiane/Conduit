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
- **TS `tokens` import** with inline `style` — now narrow: numeric node sizing (`nodeSize` width/minHeight, which can't be a class) and `AgentConfigPanel`'s `providerStyle()` heading dot. Per-provider node *colors* no longer ride inline `style` — they moved into the `cva` node primitives in `components/ui/node.tsx`, keyed by a `tone` axis (see below).

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

### One canonical token set

There are no numbered/alias token names. The old `--color-bg-1..3`, `--color-line`, `--color-line-2`, `--color-text-3`, `--color-text-4`, bare `--color-claude`/`--color-codex` aliases were removed once every consumer converged onto the semantic names that `theme.ts` exposes (`--color-bg-panel`, `--color-pill-bg`, `--color-divider`, `--color-text-muted`, `--color-claude-mark`, `--color-codex-mark`). Use those; don't reintroduce numbered scales.

## Theming (light / dark)

`tokens.css` `:root` is the light theme (`color-scheme: light`). `[data-theme='dark']` overrides the same token names with a warm-dark palette (`color-scheme: dark`) — because every primitive and page reads `var(--color-*)`, dark mode is purely a token override, no component changes. The active theme is set as `data-theme` on `<html>`: an inline no-flash script in `index.html` resolves the stored preference (`localStorage['conduit-theme']` = `system | light | dark`) against `matchMedia('(prefers-color-scheme: dark)')` before first paint; `lib/theme.ts` + `useTheme()` own the runtime read/write and live-follow the OS when the preference is `system`. The Appearance control lives on the Account Settings page.

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

`AgentConfigPanel` calls `providerStyle(provider)` and reads `ps.mark` / `ps.label` directly. The canvas node chrome no longer does: per-provider colours now live in the `components/ui/node.tsx` `cva` primitives (keyed by `tone`), which `AgentNode` / `NodePalette` / the trigger nodes select with `tone={provider}`. A header `font-sans`/`font-mono` ternary survives at those call sites for the display font.

**Adding a third provider** means an entry in `tokens.provider`, matching CSS variables in `tokens.css`, and a new `tone` across the `ui/node.tsx` primitives (`NodeShell` / `NodeIconTile` / `NodeTag` / `NodePill`). No node *call-site* edits beyond passing the new `tone`.

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
| `AgentNode` (`canvas/AgentNode.tsx`) | `ui/node.tsx` primitives (`NodeShell` / `NodeIconTile` / `NodeTag` / `NodePill`, all `tone={provider}`) for every provider colour, shadow and font; `nodeSize` for the inline width/minHeight |
| `NodePalette` (`canvas/NodePalette.tsx`) | `NodeShell` (`tone`, plus `asChild` for the draggable `<button>`) + `NodeIconTile` for both the agent and trigger cards |
| `AgentConfigPanel` (`canvas/AgentConfigPanel.tsx`) | `providerStyle()` for the heading dot + `ps.label` text; arbitrary-`var` Tailwind for the rest |
| Typed trigger nodes (`IssuesTriggerNode`, `PrTriggerNode`, `CronTriggerNode`, `WebhookTriggerPlaceholderNode` via `trigger-node-common.tsx` / `TriggerNodeShell`) + panels (`IssuesTriggerPanel`, `PrTriggerPanel`, `CronTriggerPanel` via `trigger-panel-common.tsx`), all in `canvas/` | `NodeShell tone="trigger"` + `NodeIconTile tone="trigger"` + `NodeTag tone="neutral"` for the node chrome (trigger is not provider-specific); `nodeSize` for sizing |
| `TopChrome` (`layout/TopChrome.tsx`) | Arbitrary-`var` Tailwind only — divider, panel bg, accent for the logo, pill bg for nav-icon hover |
| Component primitives in `globals.css` | `.kbd`, `.status-dot` — read CSS vars directly. The `.btn` / `.chip` / `.pill` / `.field-input` / `.prov-glyph` families were folded into the `cva` primitives in `components/ui/` (`Button`, `Badge`, `Input`/`Field`); the inline-styled React-Flow node chrome likewise became `ui/node.tsx` (`NodeShell` / `NodeIconTile` / `NodeTag` / `NodePill`) |

## `cn()` helper

`apps/web/src/lib/cn.ts` — thin `clsx` wrapper:

```ts
export const cn = (...inputs: ClassValue[]): string => clsx(inputs);
```

Use it where conditional Tailwind classes meet `var(...)` arbitrary values — e.g. `TopChrome` `NavIconLink:65-71` toggles active/inactive class strings, both of which contain `[var(--color-...)]`.
