# Views Section Fixes — Design

Date: 2026-08-09
Status: Approved

## Problem

Three issues in the GUI Views section (`packages/gui/src/renderer/src`):

1. **Alignment issues on the base Views page** (`ViewsMissionControl`): header/list edge
   padding mismatches, asymmetric row padding, negative-margin hacks, and dead CSS.
2. **The create/edit page's session picker does not use the standard session card.**
   It hand-rolls Kobalte `Checkbox` labels (`.view-session-card`) with a broken 3-column
   grid contract, disjoint class vocabulary, and duplicated markup for the terminal variant.
3. **Session states are not visible** in the picker at all, and base-page view rows show
   only a rolled-up view-level dot, not member-session states (e.g. "running").

The standard session card used throughout the app (rail sidebar, dashboard, attention
queue, project command center) is `SidebarSessionLink` in
`components/rail-sidebar-links.tsx`. It derives status via `deriveSessionStatus` and
already renders status tone classes, a `mini-spinner` while running, and a `status-glyph`
for input-needed / ready-for-review.

## Decisions

- Picker reuses the real `SidebarSessionLink` / `SidebarTerminalSessionLink`
  (chosen over extracting a shared body or CSS-only mimicry — lowest regression risk,
  pixel-identical cards).
- Selection is indicated by a real checkbox in a slim column beside the card.
- States appear in the picker (free via the standard card) **and** as an aggregate
  summary on base-page view rows. The selected-pane list is out of scope.
- Full alignment audit fixes on the base page, verified with app screenshots.

## Design

### 1. Picker card reuse (`view-editor-page.tsx`)

New local component `PickerSessionRow`:

```
div.view-picker-row [.disabled when pane limit reached and not selected]
├── Checkbox (bare control, no label content; aria-label = session title;
│             checked = selected; disabled = limitReached && !selected)
└── SidebarSessionLink { session, snapshot, active: selected, onClick: toggle }
```

- `ViewSessionGrid` and `ViewTerminalSessionGrid` both render `PickerSessionRow`.
  The terminal variant uses `SidebarTerminalSessionLink` with its existing `status`
  prop (subtitle already reads "Claude Code · <status>").
- The GUI snapshot is threaded into the picker so `SidebarSessionLink` can derive status.
- Clicking the card or the checkbox toggles selection. Selected rows show the checked
  checkbox plus the card's existing `.active` style. Disabled rows: checkbox disabled,
  card click no-ops, reduced opacity.
- Shared-component tweak: `CardContextMenu` gains a guard so an empty `actions` array
  does not open an empty context menu (the picker passes no rename/delete/pin actions).
- Deletions: hand-rolled checkbox-label markup in both grids; CSS for
  `.view-session-card`, `.view-session-card-copy`, `.view-session-selected`, phantom
  `.view-session-row`; `.view-session-card` hover blocks in `states.css`; dead
  `.view-list-card` rules in `view-list-card.css`.

### 2. Base page alignment (`views-mission-control.tsx` CSS)

All CSS-side:

- Single edge gutter: one variable (e.g. `--views-index-gutter`) used by
  `.views-index-header` and `.views-index-layout`, replacing the `18px` values in
  `views-index-header.css` that `states.css` overrides to `0` in index mode. Header
  text, search field, list header, and row edges share the same left/right line.
- Normalize `.view-summary-row` padding from `10px 8px 9px 12px` to a symmetric value
  (keeping the 4px status accent border, compensated uniformly).
- `.view-summary-session-line`: remove the `-2px` top margin and the
  `status-ready-for-review`-specific `+18px` right padding; align to the title column
  via grid placement.
- Dedupe the four repeated hover/focus blocks in `states.css`; delete dead
  `.view-list-card` / `.view-card-actions` rules.
- Verify with before/after screenshots of the running app in both index mode and
  has-active-view mode.

### 3. Session states on base-page view rows (`ViewSummaryRow`)

- Extend `view-summary.ts` (where `summarizeView` / `viewAttentionCounts` live) with a
  member-status rollup computed via the existing `deriveSessionStatus` per member.
- The row's session line renders aggregate counts in canonical vocabulary, omitting
  zero buckets: e.g. `4 sessions · 2 running · 1 needs input`. A `mini-spinner` shows
  when at least one session is running.
- The existing view-level `view-status-dot` stays unchanged.
- No new status logic or colors — everything comes from `status-system.ts` /
  `session-status.ts`.

## Error handling

- View members missing from the snapshot (stale sessions) fall back to `dormant` —
  the existing `deriveSessionStatus` behavior. Zero-member views show just the
  session count line as today.

## Testing

- Unit tests in `packages/gui/test` for the new rollup in `view-summary.ts`:
  counts per status, zero-bucket omission, stale/missing members.
- Toggle behavior (card click toggles, disabled at pane limit) and visuals verified
  in the running app; before/after screenshots for the alignment fixes.

## Out of scope

- Selected-pane list states on the create page.
- The unused design-system `ui/session-card.tsx` component (stays lab-only).
- Any backend/schema changes — status data already flows through the snapshot.
