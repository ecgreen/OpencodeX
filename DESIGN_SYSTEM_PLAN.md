# OpencodeX Design System Plan

**Goal:** make OpencodeX the best-looking, best-feeling agentic development environment (ADE) in the world. The
feature surface is already deep — multi-session orchestration, swarms, git workbench, file editing, terminals,
local and hosted model integrations. The UI must communicate that depth instead of hiding it behind
inconsistent, ad-hoc presentation.

This plan covers the Electron GUI (`packages/gui`) as the primary target and the TUI
(`packages/opencode/src/cli/cmd/tui`) as a secondary alignment target. It builds on — and does not replace —
the existing canonical spec at `packages/gui/docs/GUI_DESIGN_SYSTEM.md`. That spec and its CI enforcement
(`packages/gui/scripts/check-design-system.ts`) already solved color governance and the control boundary. This
plan finishes the system: typography, spacing, elevation, the missing component tier, token unification, and
the signature polish that separates an instrument from a college project.

---

## 1. Where we actually are (audit summary)

An honest inventory, because the plan only makes sense against it.

### Solved and enforced (do not re-litigate)

- **Color:** two-tier token system (`--theme-*` raw sources → `--ds-*` semantic aliases) in
  `styles/themes/{dark,light}.css`. Zero raw hex in component code, CI-enforced with an all-zeros baseline.
- **Control boundary:** `components/ui/` is the only place raw `<button>`/`<input>` exist. 226 `<Button>` call
  sites, zero raw buttons in feature code. Button API is `appearance × tone × size` resolved via `data-*`
  attributes in one 98-line `design-primitives.css`.
- **Cascade discipline:** explicit `@layer reset, tokens, base, primitives, layout, features, utilities, bridges`.
- **A living gallery:** `components/design-system-lab.tsx` renders every primitive across all variants.

### Broken or missing (this plan's scope)

| Axis | Current state |
| --- | --- |
| Typography | **No type tokens at all.** 23 distinct raw px sizes (145× `12px`, 106× `11px`, one `10.5px`), 23 distinct raw weights including `760`, `620`, `470`, `440`. |
| Spacing | 6-step scale exists but loses ~4:1 to raw px. Off-grid padding pairs dominate: `10px 12px`, `9px 10px`, `6px 9px`, `7px 9px`. |
| Radius | Tokens exist but `999px`/`8px`/`6px`/`7px`/`9px` are re-typed raw ~200 times; two icon-button implementations sit 1px of radius apart (`.icon-button` in `global/components/base-3.css` vs `.ui-button[data-icon-only]`). |
| Elevation | No shadow/overlay token tier; overlay treatments improvised per surface. |
| Component tier | `Tooltip`, `Dialog`, `DialogFooter`, `Popover`, `Separator` are exported and **used zero times**. Tooltips are native `title` attributes. No Tabs, Toast, Kbd, Skeleton, ProgressMeter, SegmentedControl, or SessionCard primitives — each surface improvises (~150 ad-hoc button/chip/badge/card class names across 729 selectors). |
| Token unification | **Three parallel color systems**: GUI `--theme-*` CSS vars, `@opencode-ai/ui` (762 custom properties imported wholesale for ~15 component imports), and the TUI's ~50-token RGBA theme JSON system (32 bundled themes). Same palette values hardcoded in all three. Plus three generations of aliases inside `dark.css` itself (`--ds-*`, legacy `--bg`/`--panel`/`--brand`, and `--v2-*` bridge). |
| CSS organization | 89 stylesheets named by line-count overflow (`sessions/base.css` … `base-7.css`) instead of by domain. |
| Theming | GUI ships exactly dark + light. The TUI ships 32 user-selectable themes with a public schema. No system-follow (`prefers-color-scheme`) mode in the GUI. |

The conclusion that shapes everything below: **the governance machinery works.** Color went to zero because the
checker ratchets. The fix for typography and spacing is not a rewrite — it is tokens + the same ratchet.

---

## 2. Design language: "Instrument-grade"

The existing direction statement is right and we keep it, sharpened:

> OpencodeX is a precise desktop instrument for supervising software agents. Matte graphite surfaces, crisp
> Geist typography, sparse warm highlights, semantic status color, compact geometry, quiet motion.

What "AAA" means in practice — the qualities that separate Linear/Warp/Zed-tier products from college
projects, stated as testable principles:

1. **One voice.** Every control, card, and label on every route is recognizably from the same family. A user
   should not be able to tell which screen was built first.
2. **Density with hierarchy.** An ADE is an information-dense supervision surface. Density is a feature; noise
   is not. Hierarchy comes from a strict type ramp, spacing rhythm, and tonal layering — never from adding
   borders, boxes, or colors.
3. **Grayscale-legible.** The layout reads correctly with saturation at zero. The warm accent
   (`--theme-accent`) is reserved for the primary action, selection, and focus. Status colors always pair with
   an icon, glyph, or text.
4. **Calm surfaces, live data.** Chrome is matte and still. The *data* moves — streaming tokens, status dots,
   progress meters. Animation is evidence of real activity, never decoration.
5. **Keyboard-first, palette-centric.** Every workflow reachable from the command palette and keyboard;
   shortcuts surfaced in tooltips and menus via a shared `Kbd` primitive. Pointer affordances are progressive
   disclosure on top, not the primary path.
6. **Optical precision.** Hairline borders, aligned baselines, tabular numerals for every metric (tokens,
   costs, line counts, durations), icons optically centered at consistent sizes. The 1px details are the brand.
7. **Technical character in technical places.** Geist Mono for code, diffs, paths, shortcuts, IDs, telemetry.
   Ordinary controls never cosplay as a terminal.

---

## 3. Token architecture

### 3.1 Single source of truth

Create a canonical token definition and generate every consumer from it:

```
packages/ui/src/tokens/tokens.json        (W3C design-tokens format; one file, reviewed like code)
        │
        ├─→ GUI:  styles/themes/foundation.css + dark.css + light.css   (generated CSS custom properties)
        ├─→ TUI:  semantic token names aligned with TuiThemeCurrent      (packages/plugin/src/tui.ts)
        └─→ xterm/editor bridge: terminal-presentation.ts palette map    (already reads --theme-*)
```

Rules:

- **Tier 0 — primitives:** raw values (hex ramps, px steps, ms durations). Never referenced by components.
- **Tier 1 — semantic:** `--ds-*` names describing intent (`--ds-surface-raised`, `--ds-text-muted`,
  `--ds-danger`). The only tier components may consume.
- **Tier 2 — component:** scoped vars a primitive exposes for theming (`--ui-tone`, `--ui-tone-text`). Set
  only by primitive CSS.

Migration inside `dark.css`: collapse the three alias generations. `--ds-*` is the surviving vocabulary; the
legacy short aliases (`--bg`, `--panel`, `--brand`, …) and the `--v2-*` bridge get a deletion schedule tied to
the `@opencode-ai/ui` de-vendoring in §7.1.

### 3.2 Typography tokens (new — the biggest single fix)

Eight sizes, each with a paired line-height, replacing 23 ad-hoc values. Anchored to current real usage so the
migration is mostly mechanical (the dominant 11/12/13px cluster maps 1:1):

| Token | Size / line-height | Role |
| --- | --- | --- |
| `--ds-text-2xs` | 10px / 14px | Micro labels, badge text, gutter counts. Uppercase+tracking only at this size. |
| `--ds-text-xs` | 11px / 16px | Meta rows, timestamps, captions, table headers. |
| `--ds-text-sm` | 12px / 17px | Secondary content, dense lists, sidebar rows, field labels. |
| `--ds-text-base` | 13px / 19px | **Default UI text.** Buttons, inputs, menus, cards, most controls. |
| `--ds-text-md` | 14px / 21px | Reading prose: transcript markdown, notices, settings descriptions. |
| `--ds-text-lg` | 16px / 23px | Section titles, dialog titles, panel headers. |
| `--ds-text-xl` | 20px / 27px | Page titles (`manager-page` headers). |
| `--ds-text-2xl` | 28px / 34px | Hero moments only: empty states, onboarding, splash. |

Weights — five tokens replace 23 raw values. Geist is a variable font; we keep one tuned off-grid value
(`620`, already the primitives' house weight) and ban the rest:

| Token | Value | Role |
| --- | --- | --- |
| `--ds-weight-regular` | 400 | Body and reading text |
| `--ds-weight-medium` | 500 | Emphasized body, list titles, menu items |
| `--ds-weight-semibold` | 620 | Controls, field labels, tabs, badges (current button weight) |
| `--ds-weight-bold` | 700 | Section/dialog/page titles |
| `--ds-weight-display` | 800 | Hero/brand moments only |

Supporting tokens: `--ds-tracking-caps: 0.06em` (the only sanctioned letter-spacing, for 2xs uppercase
labels), `font-variant-numeric: tabular-nums` via a `.ds-tabular` utility mandatory for metrics columns,
timers, token/cost counters, and diff stats.

Font-size and font-weight raw values become a new checker finding kind (see §8). Sizes outside the ramp —
`10.5px`, `15px`, `17px`, `22px` — are migration debt, not exceptions.

### 3.3 Spacing, radius, elevation, motion

**Spacing** — keep the 4px grid, extend the ramp upward, and make it win:

```
--ds-space-0: 2px   (hairline gaps only)        --ds-space-5: 20px
--ds-space-1: 4px                               --ds-space-6: 24px
--ds-space-2: 8px                               --ds-space-7: 32px
--ds-space-3: 12px                              --ds-space-8: 40px
--ds-space-4: 16px                              --ds-space-9: 48px
```

Guidelines (enforced by review + ratchet, not vibes):

- Padding pairs come off the grid: `4px 8px`, `8px 12px`, `12px 16px`. The current `9px 10px` / `6px 9px` /
  `7px 9px` population migrates to the nearest grid pair.
- Density recipe per context: **compact** rows (sidebar, tables) = `space-1`/`space-2`; **default** controls
  and cards = `space-2`/`space-3`; **comfortable** page sections = `space-4`–`space-6`; page gutters =
  `space-6`/`space-7`.
- Vertical rhythm: sibling cards/sections separate by `space-3` (within a group) or `space-6` (between
  groups). Never both a margin and a gap owning the same gap.

**Radius** — the three existing tokens are correct; the fix is adoption plus one addition:

```
--ds-radius-control: 6px    --ds-radius-card: 8px
--ds-radius-overlay: 10px   --ds-radius-full: 999px   (pills, dots, avatars)
```

Delete `.icon-button` (the 7px-radius duplicate); its call sites move to `IconButton`.

**Elevation** — a new, deliberately tiny tier. Attached surfaces separate by **tone + hairline border**, never
shadow; shadows exist only for *detached* surfaces:

| Token | Use |
| --- | --- |
| `--ds-elevation-overlay` | Menus, popovers, tooltips, selects — `0 4px 16px rgb(0 0 0 / 0.28)` + border |
| `--ds-elevation-modal` | Dialogs, command palette — `0 16px 48px rgb(0 0 0 / 0.42)` + border |
| `--ds-scrim` | Modal backdrop — canvas at ~55% with slight blur |

Surface ladder (already implicit, now named and documented): `canvas → surface → surface-raised →
overlay`. Each step is one tonal notch; features never invent a fifth background.

**Motion** — keep the existing tokens (`--ds-motion-hover: 120ms`, `--ds-motion-control: 160ms`,
`--ds-motion-route: 220ms`, the two easings) and add usage law: transforms and opacity only (no animated
layout properties), entrances use `--ds-ease-enter`, exits are faster than entrances (~70% duration),
`prefers-reduced-motion` collapses everything to 1ms (already wired in `foundation.css`). Infinite animation
is reserved for genuine activity (streaming, running tools) — this is also the TUI's existing
`animations_enabled` philosophy.

---

## 4. Component library plan

### 4.1 Principles

- `components/ui/` remains the single import boundary; `design-primitives.css` grows but stays the sole owner
  of `.ui-*` selectors, split by domain (not line count) if it outgrows one file.
- Every primitive: keyboard-complete, focus-visible (2px ring via `--ds-focus`), ARIA-correct, geometry-stable
  across loading/error/disabled states, and rendered in `design-system-lab.tsx` in every variant.
- Prop grammar is uniform across the library: `appearance` / `tone` / `size` mean the same thing everywhere
  they appear.
- Build on Kobalte (already in the tree via `@opencode-ai/ui/v2`) for focus/ARIA-heavy primitives rather than
  hand-rolling.

### 4.2 Tier 1 — activate what exists (highest leverage, lowest cost)

| Primitive | Action |
| --- | --- |
| `Tooltip` | Make it real and mandatory. Kill native `title` fallback in `IconButton`; render shortcut hints via `Kbd` inside tooltips. Delay ~450ms, instant for siblings within 200ms (tooltip groups). |
| `Dialog` / `DialogFooter` | Consolidate `modal-frame.tsx`, `dialog-modal.tsx`, and per-surface overlays onto one dialog primitive with standard sizes (`sm 400px / md 560px / lg 760px / full`), scrim, focus trap, and Escape law. |
| `Popover` | Adopt for the improvised anchored panels in session toolbar/inspector surfaces. |
| `Separator` | Adopt; delete per-page divider classes. |
| `.icon-button` | Delete the parallel global class; migrate to `IconButton`. |

### 4.3 Tier 2 — missing general primitives

| Primitive | Spec sketch |
| --- | --- |
| `Tabs` / `SegmentedControl` | One underlying pattern, two skins: underline tabs for panel/page-level (session side panel already needs this — `session-side-tab-bar.tsx` becomes a consumer), segmented control for exclusive value pickers. |
| `Toast` | Global queue, bottom-right, tone-mapped left accent (mirrors the TUI's toast convention), auto-dismiss with pause-on-hover, action slot. Replaces improvised inline notifications for async outcomes (git push, export, plugin install). |
| `Kbd` | Shortcut chip: mono font, `--ds-text-2xs`, hairline border, raised surface. Used in tooltips, menus, command palette, keyboard-help. |
| `Skeleton` | Shimmer-free (calm) tonal placeholder blocks respecting the type ramp; used by every async surface instead of spinners where layout is known. |
| `ProgressMeter` | Linear + tiny circular. For context-window usage, token budgets, swarm progress. Tabular-num label slot. |
| `Badge` unification | Fold `.nav-badge`, `.provider-auth-badge`, `.badge`, `.chip`, `.pill`, `.mode-chip` into `StatusBadge` (tone × appearance) + a new `CountBadge`. |
| `Breadcrumb` | Project → session → surface trail for workspace headers. |
| `Combobox` | Filterable select (Kobalte) — the pattern under the model picker, `@`-mention, and project switcher, built once. |
| `Avatar` / `AgentGlyph` | Deterministic glyph+color identity for agents/models/swarm roles — one identity system reused in cards, transcript gutters, swarm strips. |
| `DataTable` (light) | Header row grammar (`--ds-text-xs`, caps, muted), row hover, selection, tabular-num numeric columns. For sessions list, plugin manager, git file lists. |
| `ResizeHandle` | The rail already has one (`rail-resize-handle.tsx`); generalize: 1px line, 6px hit area, accent on hover/drag, double-click reset. |

### 4.4 Tier 3 — ADE signature components (where "best in class" is won)

These are product-defining composites, built from Tier 1–2 parts, each with a single owner file and page CSS
that only *places* them:

| Component | Definition |
| --- | --- |
| **`SessionCard`** | The atom of the whole product. One anatomy at three densities (rail row / dashboard card / list row): status stripe + `AgentGlyph` + title + model badge + live meta line (elapsed, tokens, cost — tabular) + progressive-disclosure actions. Status is the left accent + a glyph, mirroring the TUI's left-border card idiom so both clients share a visual signature. |
| **`StatusSystem`** | One canonical mapping of session/agent state → color token + glyph + label (`running`, `waiting-input`, `review-ready`, `blocked`, `done`, `error`, `dormant`). Today the TUI has *two competing* conventions (`opencodex-session-status.ts` hardcodes Tailwind blue/orange; `opencodex-operation-model.ts` uses theme tokens) and the GUI improvises per surface. Define once in shared code; consume everywhere including the rail, dashboard, swarm cards, and TUI. |
| **`TranscriptPart`** | Already specified (the quiet-row/accent-card system in `GUI_DESIGN_SYSTEM.md` §Transcript). Keep; extend the same anatomy to swarm/agent sub-transcripts. |
| **`DiffSurface`** | Unified diff presentation tokens (`--theme-syntax-*` + diff add/remove surfaces) shared by the diff page, git workbench, transcript file cards, and editor gutters — one visual language for "code changed". |
| **`ModelBadge`** | Provider glyph + model name + variant, one compact grammar used in composer, session cards, swarm role pickers, settings. |
| **`CommandPalette`** | Elevate to flagship interaction: `--ds-elevation-modal`, `Kbd` hints, section grammar shared with `Combobox`, recent/contextual ranking. The palette is the product's front door — it should be the single most polished surface. |
| **`EmptyState` upgrade** | Every route's empty state teaches: what this surface is, why it matters, one primary action, one `Kbd` shortcut. Hero type (`--ds-text-2xl`) + restrained illustration built from the brand's pixel-grid logo language. |

### 4.5 Deletion is part of the plan

Target: the ~150 ad-hoc button/chip/badge/card class names shrink to placement-only wrappers. Each primitive
adoption PR deletes the superseded selectors in the same change (existing house rule). The 7 page-level
selectors currently reaching into `.ui-icon-button` internals are migrated and the pattern becomes a checker
finding (`modulePrimitiveOverrides` already exists for modules; extend to global CSS).

---

## 5. Layout principles

Codifying and extending the existing layout contract:

1. **Two page archetypes, no third.** `manager-page` (scrolling: header + toolbar + content) and `workspace`
   (full-bleed: every descendant `height:100%; min-width:0; min-height:0`). Every route declares one.
2. **App frame is fixed grammar:** 36px titlebar / rail (300px, collapsible to 76px) / content. Rail
   destinations stay at four (Dashboard, Projects, Swarms, Views). Counters never change navigation geometry.
3. **One scroll owner per region.** Nested scrollbars are a defect. Sticky headers own their scroll parent.
4. **Panel grammar:** workspace panels (transcript, editor, terminal, git, browser) share one header anatomy —
   `--ds-text-sm` semibold title, muted meta, right-aligned `IconButton` cluster — and one `ResizeHandle`.
5. **Alignment beats enclosure.** Prefer whitespace and alignment to boxes-in-boxes. A card earns its border
   by being interactive or by needing separation from canvas; static info groups use spacing + a section
   title.
6. **Page gutters:** `space-6` standard, `space-7` for manager pages ≥1200px wide. Content max-width on
   reading surfaces (settings, docs-like panes): 720px.
7. **Empty space is designed.** Empty states, zero-data columns, and collapsed panels have specified
   treatments (§4.4) — never a blank void.

---

## 6. Theming

1. **GUI theme model stays semantic-first:** dark (default) + light, switched via `data-theme`, tier-1
   overrides only. Add **system-follow** mode (`prefers-color-scheme` + the existing appearance controller).
2. **Theme marketplace parity with the TUI (later phase):** the TUI already ships 32 themes against a public
   schema, and `packages/ui/src/theme/` already resolves desktop theme JSON → CSS vars. Once tokens unify
   (§3.1), user-selectable GUI themes become a resolver feature, not a redesign: a theme supplies tier-0
   values; every `--ds-*` semantic and component token derives. Editor/terminal syntax palettes come along via
   the existing `terminal-presentation.ts` bridge.
3. **Accent discipline survives theming:** themes recolor; they don't re-hierarchy. The one-solid-accent-per-
   region law and grayscale-legibility principle are theme-independent.

---

## 7. Unification and de-duplication

### 7.1 Shrink the `@opencode-ai/ui` dependency

The GUI imports the entire upstream stylesheet (762 custom properties + ~60 component sheets) to support ~15
imports. Plan: keep the genuinely valuable engines (markdown, diff/file rendering, tool-output preview),
vendor-or-wrap the six v2 controls behind `components/ui/` (already the pattern), and replace the wholesale
`@import "@opencode-ai/ui/styles" layer(reset)` with scoped imports for only the components in use. Then
delete the `--v2-*` / `--background-bg-base` bridge aliases from `dark.css`. Exit criterion: `dark.css`
contains exactly two tiers and zero bridge vocabulary.

### 7.2 Reorganize CSS by domain

Retire numbered overflow files (`base-2`…`base-8`) in favor of domain names (`sessions/transcript.css`,
`sessions/composer.css`, `workbench/git.css`, …). Mechanical, incremental, done per-page during the migration
passes in §9 — never as a big-bang rename.

### 7.3 GUI ↔ TUI shared vocabulary

Full token sharing with a terminal renderer isn't realistic (cells vs pixels), but three things are:

1. **Shared semantic names.** The TUI's `TuiThemeCurrent` vocabulary (`background/backgroundPanel/
   backgroundElement`, `text/textMuted`, `primary/accent`, status colors, diff/syntax/markdown tokens) and the
   GUI's `--ds-*` tier map onto each other almost 1:1 today. Publish the mapping table in the spec; new tokens
   land in both vocabularies or neither.
2. **Shared `StatusSystem`** (§4.4): status → color-token + glyph mapping defined once in shared code
   (`packages/core` or `packages/ui`), consumed by both clients. This also resolves the TUI's two competing
   status conventions.
3. **Shared idioms, not shared pixels.** The left accent stripe as status/selection signature, quiet-row vs
   accent-card transcript tiers, `●`-style status glyph vocabulary, one-solid-accent discipline — documented
   as cross-client design law so the TUI and GUI feel like the same product in two mediums.

TUI-specific cleanups riding along: migrate `opencodex-session-status.ts` hardcoded RGBA values to theme
tokens; converge on `opencodex-operation-model.ts`'s theme-based status mapping.

---

## 8. Enforcement: extend the ratchet

The zero-baseline checker is why color got solved. Extend `check-design-system.ts` with new finding kinds,
each starting from a **measured baseline that may only decrease**:

| New finding | Detects |
| --- | --- |
| `rawTypeSize` | `font-size` with a px/rem literal outside `foundation.css` |
| `rawTypeWeight` | `font-weight` literals outside `foundation.css` |
| `rawSpacing` | px literals in `padding`/`margin`/`gap` outside token sheets (allowlist: 1px borders, 0) |
| `rawRadius` | `border-radius` literals outside token sheets |
| `rawShadow` | `box-shadow` literals outside token sheets |
| `globalPrimitiveOverrides` | non-module CSS targeting `.ui-*` internals (closes the current gap) |
| `nativeTitleTooltip` | `title=` attributes on interactive elements once `Tooltip` lands |

Supporting checks: `design-system-lab.tsx` grows a page per new primitive (visual reference + manual QA
surface); the existing isolated visual harness captures lab screenshots for before/after review. The 400/500
line caps, single-selector-ownership, and same-change-deletion rules stay as-is.

---

## 9. Phased roadmap

Each phase ships independently; the ratchet guarantees no regression between phases.

> **Status:** Phases 0–2 are implemented on `opencodex/design-system`, along with the component lab from
> §"Component lab" in the spec. Phase 3 onward is open work. See §11 for exactly what landed.

### Phase 0 — Foundation tokens (small, unblocks everything)
Type ramp, weight ramp, extended spacing, radius-full, elevation tier, tracking/tabular utilities land in
`foundation.css`. Checker gains the new finding kinds with measured (non-zero) baselines. Primitives
(`design-primitives.css`) migrate to the new tokens — this instantly standardizes all 226 Button call sites.
**Exit:** tokens exist, primitives consume them, baselines recorded.

### Phase 1 — Activate and complete the primitive tier
Tier-1 activation (Tooltip everywhere, Dialog consolidation, Popover, Separator, `.icon-button` deletion) plus
Tier-2 builds (Tabs, Toast, Kbd, Skeleton, ProgressMeter, badge unification, Combobox, DataTable-light,
ResizeHandle). Lab pages for each. **Exit:** unused-primitive count is zero; every Tier-2 primitive has ≥1
production consumer; native-title tooltips at zero.

### Phase 2 — Signature components
`StatusSystem` (shared code), `SessionCard` at three densities, `ModelBadge`, `AgentGlyph`, `DiffSurface`
consolidation, CommandPalette elevation, EmptyState upgrades. **Exit:** rail, dashboard, and sessions list all
render the same `SessionCard`; one status mapping in the entire repo.

### Phase 3 — Route-by-route migration (the ratchet grind)
Order by traffic: **sessions workspace → dashboard → projects → swarms → views → plugins → diff → settings.**
Per route: adopt tokens (type/spacing/radius baselines → 0 for that directory), replace ad-hoc classes with
primitives + placement wrappers, rename CSS files by domain (§7.2), delete superseded selectors. **Exit:** all
raw-value baselines at zero; selector count materially down from 729.

### Phase 4 — De-vendor and unify tokens
`@opencode-ai/ui` scoped imports (§7.1), bridge-alias deletion, legacy-alias deletion, `tokens.json` source of
truth + generation pipeline (§3.1). **Exit:** one token vocabulary in the GUI; `dark.css` is two tiers.

### Phase 5 — Theming and TUI alignment
System-follow mode; GUI theme resolver over unified tokens (TUI theme-catalog parity); shared status/idiom
spec published; TUI hardcoded-color cleanup. **Exit:** both clients read as one product; GUI themes selectable.

### Phase 6 — Polish pass ("the last 10% that is the brand")
Motion audit (entrances/exits per §3.3), focus-ring audit, optical alignment sweep at 1× and 2× DPI, hover
state coverage, tabular-num coverage on every metric, empty/error/loading state coverage per route, density
review of the transcript at 30+ tool calls, onboarding/first-run experience. **Exit:** a full keyboard-only
walkthrough of every route with zero visual defects filed.

---

## 10. Success criteria

- **Mechanical:** all checker baselines (existing + new) at zero; ≤ 8 type sizes and 5 weights in the repo;
  spacing literals only in token sheets; one icon button, one dialog, one status mapping, one token vocabulary.
- **Structural:** every reusable pattern lives in `components/ui/`; page CSS contains placement only; CSS
  files named by domain.
- **Experiential:** any screen screenshotted at random is recognizably OpencodeX; grayscale screenshot still
  reads; keyboard-only completion of every core workflow; new surface built by an agent from primitives alone
  matches the system without CSS review.
- **Comparative:** side-by-side with Linear, Warp, and Zed, the density, type discipline, and motion quiet
  hold up — and the ADE-specific surfaces (transcript, swarm supervision, git workbench) have no peer to
  compare against.

---

## 11. Implementation status

### Landed

**Tokens.** `styles/themes/foundation.css` now owns the type ramp (8 sizes with paired line heights), the
weight ramp (5 values), the extended 4px spacing scale (`space-0`–`space-9`), radii including `radius-full`,
shared control heights, the elevation tier (`elevation-overlay`, `elevation-modal`, `scrim`), and motion.
`dark.css` was reduced to palette plus semantic aliases and gained the tokens the new primitives need.

**Primitives reorganized by domain.** `design-primitives.css` was replaced by `styles/primitives/{controls,
feedback,navigation,identity,overlays}.css`, all consuming tokens — no raw font sizes, weights, spacing, radii,
or shadows. `styles/design-utilities.css` adds `.ds-tabular`, `.ds-caps`, `.ds-truncate`, `.ds-technical`, and
`.ds-visually-hidden`.

**New primitives.** `Tooltip` (real, with `Kbd` shortcuts), `Dialog`/`DialogFooter` (locally owned: scrim,
focus trap, focus restoration, Escape, four sizes, non-dismissible mode), `Kbd`, `Skeleton`, `ProgressMeter`,
`Tabs`/`SegmentedControl`, `Toast`/`ToastProvider`/`useToast`, `CountBadge`, `AgentGlyph`, `ModelBadge`, and
`SessionCard` at three densities. `StatusBadge` and `Separator` were rebuilt; all three of `.ui-status`,
`.ui-separator`, and `.ui-command-row` previously had **no styles at all** despite being rendered.

**Status system.** `lib/status-system.ts` is the canonical status vocabulary. `sessionStatusTone` and
`sessionStatusLabel` now delegate to it, so the GUI has one mapping instead of several.

**Component lab.** `lab.html` plus `components/lab/*` — a six-page gallery that runs in a plain browser via
`bun run dev:lab`, with linkable theme and page state. It is excluded from the production renderer bundle.

**Enforcement.** Five new ratchet rules (`rawTypeSize`, `rawTypeWeight`, `rawSpacing`, `rawRadius`,
`rawShadow`) with recorded baselines of 397 / 188 / 981 / 220 / 110 — the measured size of the migration ahead.
Two checker rules were made more precise rather than looser: `legacyControls` now flags `variant=` only on
actual controls (it is a legitimate domain word for model and agent variants), and `duplicateGlobalSelectors`
permits `:root` to be shared across the theme sheets, which the token contract requires.

### Bug found and fixed along the way

A global `button, textarea, input { font: inherit }` reset was living in `styles/global/components/base-4.css`,
which loads in the **features** layer — above `primitives`. Because layer order outranks specificity, it
silently overrode `.ui-button`'s `font-size` and `font-weight` on **every button, input, and textarea in the
application**: controls were rendering at inherited 16px/400 instead of the intended 13px/620. The resets moved
to `design-base.css` in the `base` layer, where they belong, and the design system's typography now actually
takes effect. This is recorded as a CSS-ownership rule in the spec so it cannot recur.

### Not yet done

- Phase 3 route-by-route migration. The ~1,935 tracked raw-value findings are untouched; that is the grind the
  new baselines exist to drive down.
- Native `title` tooltips still stand in for `Tooltip` on icon buttons that do not pass a `tooltip` prop. The
  primitive is wired and used, but converting all 44 call sites changes DOM structure and wants visual
  verification, so it was not done blind.
- The new primitives are built and demonstrated but not yet adopted by feature code; `SessionCard` does not yet
  back the rail, dashboard, and sessions list.
- Phases 4–6 (de-vendoring `@opencode-ai/ui`, token unification, theming, TUI alignment, polish) are untouched.
- The renderer bundle-size budget fails, but it failed identically before these changes (1240.5 KiB baseline
  versus 1251.6 KiB now); it is pre-existing debt, not a regression introduced here.

## Appendix A — Quick reference card

| Decision | Value |
| --- | --- |
| UI font / technical font | Geist / Geist Mono (bundled, variable) |
| Default text | 13px/19px, weight 400 |
| Control text | 13px, weight 620 |
| Meta text | 11px/16px, muted |
| Page title | 20px/27px, weight 700 |
| Grid | 4px; padding pairs from the ramp |
| Radii | control 6 / card 8 / overlay 10 / full 999 |
| Surface ladder | canvas → surface → surface-raised → overlay |
| Shadows | detached surfaces only (overlay, modal) |
| Motion | 120/160/220ms; transforms+opacity only; reduced-motion → 1ms |
| Accent | one solid accent action per region; accent = primary/selection/focus only |
| Status | color + glyph + label, never color alone; one shared mapping |
| Focus | 2px visible ring, `--ds-focus`, everywhere |
| Touch/click targets | 28–32px dense minimum, never < 24px |
| Numerals | tabular-nums for all metrics |
