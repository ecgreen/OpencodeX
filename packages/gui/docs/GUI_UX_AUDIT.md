# OpencodeX GUI UX Audit

Date: 2026-06-15

## Summary

This audit covers the current OpencodeX GUI after the premium UI pass. The app has a stronger visual direction now: a terminal-native desktop shell, local Solid UI primitives, lazy lucide icons, square session/view cards, and a working Onlook/Vite preview target. The next UX pass should focus less on new styling and more on consolidation: make the new design system the only path, remove native browser dialogs, reduce stylesheet override debt, and bring secondary screens up to the same craft level as the dashboard/session/workbench improvements.

Baseline used:

- Static mapping with Graphify against the existing GUI/TUI graph.
- Source inventory of dashboard, rail/sidebar, session, workbench, views, swarms, collection pages, dialogs, command palette, model picker, plugins/status, and shared UI.
- Preview smoke test with real local app target at `http://127.0.0.1:5174/`.

Visual automation note:

- The preview server served successfully with status `200`, title `OpencodeX`, and Vite ready in roughly `625ms`.
- Full in-app browser screenshot QA could not be completed in this sandbox because the browser helper failed to spawn with `CreateProcessAsUserW failed: 5`. Treat this report as a static-plus-smoke audit until a local desktop/browser pass captures screenshots.

## Implementation Status

Completed in the backlog sweep:

- Replaced Workbench native `prompt()`/`confirm()` flows with app-dialog props and modal primitives.
- Split the global stylesheet into imported section files at valid CSS rule boundaries; section files are now under the 500-line target.
- Added shared modal framing and moved model picker/open-file/dialog surfaces onto the same overlay primitive.
- Split session page, transcript, composer, toolbar, model picker, safety panels, dashboard primitives, rail drag preview, Workbench diagnostics/browser/artifacts/Git/open-file panels, store types/actions, Workbench utilities, and live-session patch helpers into focused modules.
- Continued the Workbench root split with dedicated assistant, browser, Git, editor, file-explorer, page-helper, diagnostics, artifacts, and open-file modules. Browser, Git, and Workbench assistant state now live in focused controller modules under the 500-line target.
- Restored plugin API header/error semantics and Workbench Git summary coverage after the store/workbench split.

Remaining structural debt:

- `packages/gui/src/renderer/src/app.tsx` and `packages/gui/src/renderer/src/components/workbench-page.tsx` are still orchestration roots above the 500-line target. The next refactor should split app route rendering/slash-command handlers and the remaining Workbench file/explorer/diagnostics controller responsibilities before further UI polish.
- Browser screenshot QA still needs a local desktop run because the in-app browser helper could not spawn in this environment.

Validation after this sweep:

- `bun run typecheck`
- `bun run test` (`252` passing tests)
- `bun run build`
- Ports `5173` and `5174` verified clear after validation.

## Ranked Backlog

### P0 - Workbench native dialogs break the premium app model

Affected surface: Workbench files/git flows.

Evidence:

- `packages/gui/src/renderer/src/components/workbench-page.tsx` still calls native `confirm()` or `prompt()` for project switches, tab close/discard, rename, delete, git discard, and stash drop.
- Specific hits are at `workbench-page.tsx:521`, `529`, `597`, `612`, `687`, and `749`.
- The app already has custom dialog infrastructure in `dialog-modal.tsx` and async dialog plumbing in `app.tsx`.

Impact:

- Native dialogs feel abrupt and OS-default, do not match the premium UI, are hard to scan, and cannot carry project/file context as well as an in-app modal.
- They also interrupt keyboard flow and cannot use the app's button hierarchy, danger styling, or focus treatment.

Recommended fix:

- Thread app-level dialog helpers into `WorkbenchPage` as props: `confirm`, `askText`, and optionally `alert`.
- Replace every Workbench `prompt()` and `confirm()` with the existing custom dialog state.
- Use destructive confirmation copy that names the file, action, and consequence.

Acceptance criteria:

- No direct `prompt()` or `confirm()` calls remain in `workbench-page.tsx`.
- Destructive Workbench actions use the same modal visuals as session/view/project deletes.
- Escape, Enter, and focus restore work consistently.

### P0 - Stylesheet token and override debt is now the largest visual risk

Affected surface: global GUI styling.

Evidence:

- `packages/gui/src/renderer/src/styles.css` is `8215` lines.
- It contains an older token layer near the top, a newer shadcn-style token layer around `:root` near line `7879`, and late focused overrides after line `9000`.
- Hard-coded color and surface rules remain throughout the file, including Workbench-specific VS Code-like tokens around line `5862`.

Impact:

- Small future changes can regress earlier surfaces because the cascade is order-dependent.
- Light and dark themes may drift because some surfaces use `--surface`/`--brand`, others use `--panel`/`--primary`, and others use raw hex values.
- The design system exists, but the stylesheet still behaves like layered patches.

Recommended fix:

- Split the stylesheet into scoped files or clear sections imported in stable order: tokens, base, ui primitives, shell/rail, dashboard, session, workbench, managers, overlays.
- Promote the new token layer to the single source of truth and map old tokens onto it once.
- Remove late overrides once their target rules are moved into the owning section.

Acceptance criteria:

- One canonical dark/light token block controls surfaces, borders, focus rings, shadows, and semantic colors.
- No duplicated `:root` design-system declarations for the same concepts.
- New components can be styled without adding another end-of-file correction block.

### P1 - UI primitive adoption is uneven

Affected surfaces: collection pages, views manager, swarms, Workbench, command palette, dialogs, plugins, secondary action rows.

Evidence:

- Component inventory found `235` raw `<button>`, `<input>`, `<textarea>`, or `<select>` controls.
- `workbench-page.tsx` alone has `61` raw buttons and `13` raw form controls.
- `session-page.tsx` has `21` raw buttons.
- `views-manager-page.tsx` has `15` raw buttons.
- `collection-pages.tsx` has `11` raw buttons.
- The new primitives live in `packages/gui/src/renderer/src/components/ui/index.tsx`, but most screens still bypass them.

Impact:

- Button sizing, icon spacing, hover states, disabled states, and danger hierarchy remain inconsistent across screens.
- The dashboard can feel premium while adjacent pages feel older or more administrative.

Recommended fix:

- Adopt `Button`, `IconButton`, `TextInput`, `TextArea`, `CommandRow`, `StatusBadge`, and `SurfaceCard` across secondary pages first.
- Prioritize dense action rows and icon-only utility actions before broad card rewrites.
- Keep card layouts intact for session/view cards.

Acceptance criteria:

- Raw controls remain only where native semantics are essential, such as `select`, checkbox inputs, and CodeMirror internals.
- Dense rows use icon-only buttons with labels/tooltips for utility actions.
- Primary, secondary, ghost, quiet, and destructive states look identical across dashboard, Workbench, views, and swarms.

### P1 - Secondary pages still read as placeholder/admin screens

Affected surfaces: session collection, project collection, status page, views manager, swarm editor/detail, artifacts page, browser toolbar.

Evidence:

- `collection-pages.tsx` uses `placeholder-page`, generic explanatory copy, and raw text action buttons.
- Views and swarms use their own `ManagerHeader`/`PageHeader` patterns rather than shared page/toolbar primitives.
- Browser toolbar still includes many visible text buttons: Back, Forward, Reload/Stop, Go, Screenshot, Save page, Ask agent, DevTools.

Impact:

- The GUI quality drops when leaving the main dashboard/session path.
- Repeated explanatory copy makes the app feel less like a focused desktop tool and more like an internal admin console.

Recommended fix:

- Replace placeholder page language with compact operational headers.
- Convert secondary page actions to the same polished button and icon button hierarchy used on the dashboard.
- Make browser toolbar dense: icon buttons for navigation/reload/devtools/screenshot/save, primary icon-only go button, visible text only where ambiguity is high.

Acceptance criteria:

- Sessions/projects/status pages no longer use `placeholder-page` styling or explanatory filler copy.
- Browser toolbar fits on narrow desktop without wrapping awkwardly.
- Swarm/view editor actions visually match dashboard/session actions.

### P1 - Modal and palette focus behavior needs a dedicated pass

Affected surfaces: dialog modal, command palette, model picker, open-file modal, slash/mention menus.

Evidence:

- `dialog-modal.tsx`, `command-palette.tsx`, and the model picker each implement their own backdrop, close button, keyboard handling, and focus behavior.
- Close buttons render as text `x` or multiplication-style glyphs in several places instead of consistently using `IconButton`.
- Command palette supports arrow keys, but focus trapping and return-focus behavior are not centralized.

Impact:

- Keyboard users can encounter inconsistent Escape/Enter handling and focus escape.
- Overlay polish is only as good as each individual implementation.

Recommended fix:

- Add a small local `ModalFrame`/`DialogFrame` primitive that owns backdrop, Escape, close button, focus entry, and return-focus.
- Keep content-specific bodies inside each modal.
- Convert close actions to `IconButton icon="x"` with consistent labels.

Acceptance criteria:

- Command palette, model picker, dialog modal, and open-file modal share backdrop, radius, shadow, close affordance, and focus behavior.
- Escape closes every overlay.
- Focus returns to the opener after close where practical.

### P1 - Workbench performance and loading paths need profiling

Affected surface: Workbench files/git/assistant.

Evidence:

- `workbench-page.tsx` is `1992` lines and owns files, git, browser, artifacts, assistant session state, file search, diagnostics, and persistence.
- It polls file/git state every `4500ms`.
- It runs separate reactive `findFiles()` flows for explorer search and open-file modal search.
- It calls `listWorkbenchFiles()` for every loaded folder during sync.
- Assistant session data loads through its own `loadSession()` path.

Impact:

- The Workbench can feel slower than the rest of the app, especially on large repositories or networked filesystems.
- Performance fixes are harder because state ownership is concentrated in one component.

Recommended fix:

- Add lightweight instrumentation before refactoring: measure initial Workbench mount, file tree refresh, open-file search latency, diagnostics latency, git refresh latency, and assistant session load.
- Debounce file search inputs explicitly and cancel or ignore stale requests consistently.
- Split Workbench into local subcomponents after measurement: file explorer, editor tabs, diagnostics, git panel, browser panel, artifacts panel, assistant panel.

Acceptance criteria:

- Audit has timing numbers for real local data.
- Repeated folder sync does not refresh unchanged folders unnecessarily.
- Opening the assistant panel does not show a resetting spinner when cached session data exists.

### P2 - Dashboard project view is useful but needs state polish

Affected surface: dashboard project detail view.

Evidence:

- Project cards now open a project detail view with attention, recent sessions, views, past sessions, and folders.
- The detail view is rendered above the projects section and does not have a URL/route state.

Impact:

- The interaction is promising, but users can lose context on refresh or navigation.
- Larger projects may need stronger sorting/filtering once real data grows.

Recommended fix:

- Preserve selected project in URL state or local dashboard state if it becomes a primary workflow.
- Add compact empty and overflow handling for each project sublist.
- Consider a visible selected state on the source project card.

Acceptance criteria:

- Clicking a project clearly changes context.
- Returning to projects is obvious and keyboard reachable.
- Large project folders/session lists do not dominate the dashboard.

### P2 - Some icon choices and dense labels still need grooming

Affected surfaces: dashboard actions, Workbench toolbar, session overflow, swarms/views actions, model picker.

Evidence:

- The app has `lucide-solid` lazy icon loading and shared `IconButton`, but many surfaces still use text buttons with icons.
- Some actions still use broad labels such as `Create`, `Open`, `Go`, `Send`, or repeated object nouns where the surrounding context already explains the action.

Impact:

- Dense toolbars still feel busier than they need to.
- Button hierarchy is sometimes driven by copy length rather than task importance.

Recommended fix:

- Audit action rows screen by screen and classify each action as primary, secondary, utility, destructive, or overflow.
- Convert utility actions to icon-only buttons with titles/labels.
- Keep visible text for destructive actions in menus and for primary form submits where clarity matters.

Acceptance criteria:

- Toolbars scan by shape and icon first.
- No crowded row has repeated object words like `Session`, `Project`, or `View` unless needed for clarity.
- Destructive actions remain visually distinct but not noisy.

## Quick Wins

1. Replace Workbench native `prompt()` and `confirm()` with app dialogs.
2. Convert `collection-pages.tsx` action rows to `Button` and `IconButton`.
3. Replace overlay close text with `IconButton icon="x"`.
4. Move the late focused corrections in `styles.css` into their owning sections.
5. Convert browser toolbar utility actions to icon buttons.
6. Add a visible selected state for dashboard project cards when the project detail panel is open.

## Larger Refactors

1. Split `styles.css` into a stable token/base/component/page structure.
2. Standardize all overlays on one local modal frame primitive.
3. Decompose `WorkbenchPage` into focused subcomponents after adding timing instrumentation.
4. Promote a shared page header/action-row pattern for views, swarms, collections, plugins, and status.
5. Create a small visual QA checklist with screenshots for desktop, narrow desktop, and mobile-width browser.

## Visual QA Checklist For Follow-Up

Run:

```sh
bun --cwd packages/gui run onlook:preview -- --port 5174 --strictPort
```

Then inspect `http://127.0.0.1:5174/` with real local data:

- Dashboard: populated projects, empty-ish sections, project detail view, card hover/focus, light/dark theme.
- Sidebar: expanded, collapsed rail, hover expansion, pinned/session/view cards, drag affordances.
- Session: empty session, active transcript, blocked permission/question state, long transcript, model picker, slash menu, mention menu.
- Workbench files: explorer, open-file modal, diagnostics, editor toolbar, assistant open/close.
- Workbench git: changed files, diff preview, history, stash actions, destructive confirmations.
- Workbench browser/artifacts: toolbar wrapping, tab actions, screenshot/save/send flows.
- Views: list, detail, create/edit, session card selection.
- Swarms: list, detail, create/edit, task assignment.
- Overlays: command palette, dialog modal, export modal, model picker, open-file modal.

## Validation Notes

Commands intended for this audit:

```sh
bun --cwd packages/gui run typecheck
bun --cwd packages/gui run test
bun --cwd packages/gui run build
```

Preview smoke result:

- `bun run onlook:preview -- --port 5174 --strictPort` served successfully.
- Local HTTP probe returned status `200`, title `OpencodeX`.

Browser automation result:

- In-app browser automation was attempted but blocked by the sandbox helper launch failure.
- A manual or unsandboxed browser pass should capture the screenshots before closing any visual regressions.
