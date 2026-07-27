# OpencodeX GUI Design System

This document is the canonical specification for the OpencodeX GUI. The renderer adapter in
`src/renderer/src/components/ui` is the only supported application-control boundary. Repository skills,
agent instructions, component tests, and visual references link here rather than restating these rules.

## Instrument-grade direction

OpencodeX is a precise desktop instrument for supervising software agents. The interface uses matte graphite
surfaces, crisp Geist typography, sparse warm highlights, semantic status color, compact geometry, and quiet
motion. Technical character belongs in code, telemetry, diffs, shortcuts, and terminals; ordinary controls do
not imitate a terminal.

The visual hierarchy must remain legible in grayscale. The warm accent is reserved for the primary action,
selection, and focus. Success, warning, danger, and information colors always include text, an icon, or shape.

## Token contract

Theme ownership is split into explicit boundaries:

- `styles/themes/foundation.css`: fonts, spacing, radii, motion, and typography.
- `styles/themes/dark.css`: the default dark palette plus compatibility aliases.
- `styles/themes/light.css`: light-mode semantic overrides only.
- `styles.css`: the ordered import manifest; it contains no visual declarations.

The theme sheets expose:

- Palette: graphite, warm accent, and semantic status source colors.
- Typography: locally bundled Geist Sans and Geist Mono.
- Type ramp: eight sizes, each paired with a line height. `2xs` 10/14 for micro labels and badges,
  `xs` 11/16 for meta rows and captions, `sm` 12/17 for secondary content and field labels,
  `base` 13/19 as the default UI text, `md` 14/21 for reading prose, `lg` 16/23 for section and dialog
  titles, `xl` 20/27 for page titles, and `2xl` 28/34 for hero moments only. Nothing outside this ramp ships.
- Weight ramp: `regular` 400, `medium` 500, `semibold` 620, `bold` 700, and `display` 800. Geist is variable,
  but only these five values are legal.
- Letter-spacing: `--ds-tracking-caps` on uppercase `2xs` labels is the only sanctioned value.
- Numerals: every metric, timer, count, and cost uses tabular numerals through `.ds-tabular`.
- Spacing: a 4px grid using 4, 8, 12, 16, 20, 24, 32, 40, and 48px steps, plus a single 2px sub-grid step
  (`--ds-space-0`) reserved for hairline gaps. Padding pairs come off the grid.
- Shape: 6px controls, 8px cards, 10px overlays, and 999px pills.
- Control geometry: 28px compact, 32px default, and 36px prominent, shared by every control primitive.
- Motion: 120ms hover/press, 160ms control changes, 220ms panels/routes, with
  `cubic-bezier(0.16, 1, 0.3, 1)` for entrances.
- Elevation: borders and tonal separation for attached surfaces; shadows only for detached overlays.
  `--ds-elevation-overlay` for menus, popovers, and tooltips, `--ds-elevation-modal` for dialogs, and
  `--ds-scrim` for modal backdrops.

Surfaces step in one direction only: `canvas` to `surface` to `surface-raised` to `overlay`. Features never
introduce a fifth background.

Semantic tokens describe intent: canvas, surface, raised surface, text, muted text, border, focus, selection,
control accent, danger, warning, success, and information. Components consume semantic tokens only. Raw
application colors are allowed only in the dark and light theme sheets. Approved editor, terminal, and plugin
theme data may contain library color values when those APIs cannot consume CSS variables.
Feature and page styles may consume `--theme-*` tokens but may never declare or override them.

## Control contract

Pages arrange controls; they do not restyle their padding, radius, focus, hover, loading, selected, disabled,
or destructive states.

### Buttons

- Appearance: `solid`, `soft`, `outline`, or `ghost`.
- Tone: `neutral`, `accent`, `danger`, `success`, `warning`, or `info`.
- Size: `compact` (28px), `default` (32px), or `prominent` (36px).
- One solid accent action is allowed per region. Secondary actions use outline or ghost treatment.
- Destructive actions remain progressively disclosed and use danger styling at the final decision point.
- Icon-only controls have an accessible label, tooltip, 28-32px target, and visible focus.
- Loading and validation preserve geometry.

Legacy button variants are compatibility inputs only. New code uses appearance, tone, and semantic size.

### Fields

`TextField`, `SearchField`, and `TextArea` own labels, descriptions, required state, errors, loading, affixes,
clearing, technical text, disabled, and read-only treatment. Form fields fill their available width. Error and
description rows reserve stable space so validation cannot move adjacent content.

`Select` is the selection control and uses the accessible shared Kobalte implementation. `Menu` and
`DropdownMenu` are action surfaces. Selection and action APIs must never be interchangeable.

### Feedback and overlays

Cards, status labels, notices, skeletons, empty states, loading states, errors, dialogs, menus, popovers, and
toasts use shared primitives. Empty and error states explain what happened, why it matters, and provide at most
one primary recovery action.

`Tooltip` is the only tooltip surface. The native `title` attribute is a fallback for controls that have not
been migrated, never a choice for new code, and never present alongside a real tooltip. `Dialog` owns the
scrim, focus trap, focus restoration, and Escape behavior; a scrim click dismisses only when the press began
on the scrim. Destructive confirmations pass `dismissible={false}`.

`Skeleton` replaces a spinner wherever the final geometry is known. `ProgressMeter` carries context-window,
budget, and completion progress. `Kbd` renders every keyboard binding, adapting modifiers to the platform.
`Tabs` is one engine with two skins: underline for panel and page navigation, segmented for exclusive value
pickers.

### Status

`lib/status-system.ts` is the single status vocabulary. It maps any status string to a tone, a glyph, and a
label, so one state reads identically in the rail, the dashboard, a list, a badge, and the palette. Status is
never communicated by color alone. Adding a status means adding it to that table, not to a component.
`SessionCard` is the one session surface, rendered at `rail`, `row`, or `card` density; `AgentGlyph` and
`ModelBadge` are the one identity and model grammar.

## Layout contract

Every route declares either a scrolling manager-page layout or a full-bleed workspace layout. A region has one
intentional scroll owner. Full-bleed descendants use `height: 100%`, `min-width: 0`, and `min-height: 0` through
the complete sizing chain. Feature CSS Modules may control placement and dimensions but cannot target primitive
internals.

The four permanent rail destinations are Dashboard, Projects, Swarms, and Views. Plugin management remains an
internal or palette destination, while workbench tools surface in session context. Counters may not change navigation geometry. A clickable card
is its primary action; nearby utilities are progressively disclosed on hover and `:focus-within` and remain
keyboard accessible.

## CSS ownership

Production cascade order is explicit: `reset`, `tokens`, `base`, `primitives`, `layout`, `features`, `utilities`,
and `bridges`.

- Global CSS: tokens, reset/base, primitives, shell/layout contracts, accessibility utilities, and bridges.
- Element resets (`button`, `input`, `textarea`) belong in the `base` layer. Placing them in any layer above
  `primitives` silently overrides every control's typography, because layer order outranks specificity.
- `styles/primitives`: control, feedback, navigation, identity, and overlay visuals, split by domain.
- `styles/global`: shared component, shell, and overlay ownership.
- `styles/pages`: route ownership divided by Dashboard, Sessions, Projects, Views, Swarms, Workbench, Plugins,
  and Diff.
- Primitive CSS: all control visuals.
- Page-owned files arrange features but cannot redefine primitive internals.
- A migration deletes superseded selectors in the same change; correction, polish, terminal-native, and vNext
  layers are transitional debt, not extension points.
- Authored TS, TSX, and CSS stay below 500 lines and normally below 400.
- A selector has exactly one owner within an equivalent at-rule context. Raw colors, theme-token overrides,
  duplicate selector owners, and unauthorized `!important` declarations are zero-baseline CI failures.
- Raw font sizes, font weights, spacing, radii, and shadows are tracked against a recorded baseline that may
  only decrease. New code uses tokens; migrations ratchet the count down and never up.

## Transcript visual language

Every transcript part - tool call, tool group, thinking block - shares one anatomy so header rules are written
once and apply everywhere:

```
.part[data-kind][data-status]      <details> or <div>, identical classes either way
  .part-header                     <summary>, or <div> with .part-header-static
    .part-chevron .part-icon .part-title .part-meta .part-status
  .part-body                       tool details, thinking segments, group list
```

Parts render in one of two tiers. Routine evidence is a **quiet row**: one line, no border or fill, chevron in
the assistant gutter. Deliverables and attention states are an **accent card**: hairline border, three-pixel
left accent stripe, raised surface, card radius. Errors are always a card regardless of tool, because a failure
is never routine. This split keeps a turn containing thirty greps scannable while letting a plan or a diff
carry weight.

| `data-kind` | Tools | Accent token | Tier |
| --- | --- | --- | --- |
| `search` | read, grep, glob, list | none | row |
| `web` | webfetch, websearch, browser_* | none | row |
| `exec` | bash, shell | `--ds-accent-exec` | row |
| `file` | edit, write, apply_patch | `--ds-accent-file` | card |
| `plan` | todowrite, question, plan_exit | `--ds-accent-plan` | card |
| `agent` | task, skill, swarm create | `--ds-accent-agent` | row |
| `thinking` | reasoning | `--ds-accent-thinking` | card |
| any, `data-status="error"` | - | `--ds-danger` | card |

Categories and tiers are resolved once in `lib/tool-display.ts` (`toolCategory`, `toolTier`); CSS selects on the
resulting attributes and never re-derives them from tool names or `:has()`.

Titles use one grammar: **verb, then object, then an optional count** - `Read src/app.ts`, `Patch 3 files`,
`Grep "needle" in src (2 matches)`. A title resolves from the registry first, then the server-streamed progress
title, then a humanized tool id, so MCP and plugin tools stay readable. Interaction instructions are never
titles or status text, and every "there is more than we showed" control uses the single `COPY_FULL_LABEL`.

Disclosure follows the work. A part opens automatically while it is running and whenever it failed; a completed
part collapses to a one-line receipt, except todo writes and patches, which are the deliverable. An explicit
user toggle always wins over the automatic state and persists for the session. Nothing auto-collapses while the
reader has scrolled away from the bottom.

## Accessibility and motion

Meet WCAG 2.2 AA. Every workflow is keyboard-operable with visible two-pixel focus, correct labels, non-color
status communication, predictable Escape behavior, and focus restoration. Dense utilities target 28-32px and
never fall below 24px. Reduced motion removes transforms and collapses nonessential timing to 1ms. Infinite
animation is reserved for genuine activity indicators.

## Protected behavior

The centralized session transcript scroll contract and existing Git comparison behavior are product contracts,
not styling opportunities. GUI design work does not change server, SDK, persistence, route payloads, or TUI
presentation unless separately authorized.

## Component lab

`bun run dev:lab` serves the component gallery at `/lab.html` in an ordinary browser, with no Electron process
and no backend. It renders the real primitives from `components/ui` across six pages: foundations, controls,
feedback, navigation, overlays, and signature components. Theme and page are encoded in the query string, so a
specific state is linkable. `bun run build:lab` emits a standalone copy to `dist/lab`.

Every new primitive lands with a lab specimen in the same change. The lab is a development surface: it is
exempt from the raw-control and raw-value rules, and it is never part of the shipped renderer bundle.

## Validation policy

Use package-scoped static and unit checks. Visual automation runs only in the isolated repository harness with
one worker, no published display/input, no more than two CPUs, and no more than 3GB of memory. It must clean up
all browser and Electron processes. Never confine or automate the host pointer or keyboard. If isolation is
unavailable, record the visual gate as blocked and continue with static, unit, build, and geometry evidence.
