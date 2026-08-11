# Composer Queue Restyle — Design

**Date:** 2026-08-11
**Status:** Approved (visual direction validated via brainstorm companion mockups)

## Problem

The queued-messages UI (`ComposerQueuedPrompts`) renders as a bordered panel inside the composer card — a box-in-a-box with circled number badges, an "Up next" heading with an accent count pill, and always-visible edit/remove buttons on every row. It works, but it is visually heavy and looks bolted-on next to the composer's design language.

User-validated direction: **"Attached tray"** — the queue becomes a slightly darker tray fused to the top of the composer card, sharing its silhouette, with quiet compact rows and hover-revealed actions. Overall sizing one step smaller than today, including the Direct/Queue delivery buttons.

## Scope

- `packages/gui/src/renderer/src/components/session-composer.tsx` — move `ComposerQueuedPrompts` render location
- `packages/gui/src/renderer/src/components/session-composer-delivery.tsx` — markup simplification
- `packages/gui/src/renderer/src/styles/pages/sessions/composer-footer.css` — restyle `.composer-queued-*`, delivery button sizing
- `packages/gui/src/renderer/src/styles/pages/sessions/composer-input.css` — `has-queued` modifier
- `packages/gui/test/session-followup-queue.test.ts` — update only if the markup move breaks selectors

Out of scope: queue logic, edit/remove dialogs, hold-on-dialog behavior, keyboard shortcuts, server-side anything.

## Design

### 1. Structure

`ComposerQueuedPrompts` moves from inside `.composer-input` to its immediate previous sibling (still inside the composer form, so dialogs and props flow unchanged).

When the queue is non-empty:

- The tray carries the card's rounded **top** corners and the same 3px left accent border as `.composer-input`.
- `.composer-input` gains a `has-queued` class: top border-radius set to 0.
- A single hairline separates tray from input: `border-top` on `.composer-input.has-queued`, matching the mockup. The tray itself has no bottom border.

Result: tray + composer read as one fused card. When the queue is empty the tray renders nothing and the composer is byte-for-byte unchanged.

### 2. Tray visual spec

- **Background:** one step darker than the composer surface. Dark theme: subtle darken relative to `--surface-raised` (mockup used `#171b22` vs composer `#1b2028`; implement as `color-mix(in srgb, var(--surface-raised) 88%, black)` unless an existing token already matches). Light theme: one subtle step down from `--theme-surface-composer`, keyed off the existing `:root[data-theme="light"]` override.
- **No visible heading, no count pill, no outer border of its own.** The `<section>` keeps `aria-label` with the count; the count live-announcement moves to a visually-hidden `aria-live="polite"` element.
- **Rows** (`.composer-queued-prompt`):
  - min-height ~22px, font-size `--ds-text-xs`, muted text color (`--theme-text-muted` at rest)
  - plain right-aligned tabular numeral index (no circle, no border), ~10px, extra-muted
  - single-line ellipsis truncation with full text in `title` (unchanged)
  - hairline separator between rows (subtle, ~4% white in dark / `--theme-border-subtle` in light); no separator after the last row
  - hover / `:focus-within`: faint row background tint (`--theme-surface-hover` or equivalent rgba), text steps up to brighter color
- **Actions** (edit ✎ / remove ✕ `IconButton`s): `opacity: 0` at rest, fade to 1 on row `:hover` and `:focus-within` (~120ms transition). Keyboard reachable exactly as today — focusing a button reveals it via `:focus-within`. Compact size, ~17px hit target inside a comfortable padding box.
- **Scrolling:** keep `max-height` (~96px) with `overflow-y: auto` on the list.

### 3. Delivery buttons (Direct / Queue)

- Keep existing `leadingIcon="send"` (Direct) and `leadingIcon="listTodo"` (Queue) props. Verify the icons actually render in the app; if the `Button` component drops `leadingIcon` at `size="compact"`, fix that rendering path.
- One size step smaller than current compact rendering: ~10.5–11px label, tighter padding, ~22px height, ~11px icons. If the design system lacks a smaller size token, scope the shrink with a local class (e.g. `.composer-delivery-actions .ds-button { … }`-style override kept in `composer-footer.css`).

### 4. Unchanged behavior

- Edit and remove confirmation dialogs, including `hold` (auto-send suspension while a dialog is open) and stale-item dialog auto-close.
- Queue ordering, update/remove plumbing, submit paths.
- `composer-queued-*` class names are preserved so `session-followup-queue.test.ts` selectors keep working; tests are touched only if the markup move itself breaks them.

## Error handling

Pure presentational change — no new failure modes. Empty queue renders nothing (existing `Show when={props.prompts.length > 0}` guard).

## Testing

- `bun test packages/gui/test/session-followup-queue.test.ts` must pass (update selectors only if the structural move requires it).
- Add/extend a test asserting the tray renders as a sibling of `.composer-input` and that `has-queued` toggles with queue emptiness, if the existing test doesn't already pin structure.
- Manual visual check in dark and light themes: fused silhouette, hover reveal, scroll at 5+ queued items, focus-visible reveal via keyboard Tab.
