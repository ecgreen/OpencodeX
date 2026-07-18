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
- Spacing: a 4px grid using 4, 8, 12, 16, 20, and 24px steps.
- Shape: 6px controls, 8px cards, and 10px overlays.
- Motion: 120ms hover/press, 160ms control changes, 220ms panels/routes, with
  `cubic-bezier(0.16, 1, 0.3, 1)` for entrances.
- Elevation: borders and tonal separation for attached surfaces; shadows only for detached overlays.

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

## Layout contract

Every route declares either a scrolling manager-page layout or a full-bleed workspace layout. A region has one
intentional scroll owner. Full-bleed descendants use `height: 100%`, `min-width: 0`, and `min-height: 0` through
the complete sizing chain. Feature CSS Modules may control placement and dimensions but cannot target primitive
internals.

The six permanent destinations remain Dashboard, Projects, Sessions, Views, Swarms, and Workbench. Status and
Settings remain internal or palette destinations. Counters may not change navigation geometry. A clickable card
is its primary action; nearby utilities are progressively disclosed on hover and `:focus-within` and remain
keyboard accessible.

## CSS ownership

Production cascade order is explicit: `reset`, `tokens`, `base`, `primitives`, `layout`, `features`, `utilities`,
and `bridges`.

- Global CSS: tokens, reset/base, primitives, shell/layout contracts, accessibility utilities, and bridges.
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

## Accessibility and motion

Meet WCAG 2.2 AA. Every workflow is keyboard-operable with visible two-pixel focus, correct labels, non-color
status communication, predictable Escape behavior, and focus restoration. Dense utilities target 28-32px and
never fall below 24px. Reduced motion removes transforms and collapses nonessential timing to 1ms. Infinite
animation is reserved for genuine activity indicators.

## Protected behavior

The centralized session transcript scroll contract and existing Git comparison behavior are product contracts,
not styling opportunities. GUI design work does not change server, SDK, persistence, route payloads, or TUI
presentation unless separately authorized.

## Validation policy

Use package-scoped static and unit checks. Visual automation runs only in the isolated repository harness with
one worker, no published display/input, no more than two CPUs, and no more than 3GB of memory. It must clean up
all browser and Electron processes. Never confine or automate the host pointer or keyboard. If isolation is
unavailable, record the visual gate as blocked and continue with static, unit, build, and geometry evidence.
