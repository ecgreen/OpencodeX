# PROJECT_CLEANUP — Projects pages UI/UX pass

A full cleanup and redesign plan for the **Projects overview** page and the **individual project** page
in the GUI. Goal: each page earns its place — it looks good, uses color and status deliberately, gives
real feedback, and answers the question the user actually has ("what needs me?", "where do I pick up?")
instead of just enumerating records.

---

## 1. The pages today

### 1.1 Routing and data flow

- No router library; a plain route signal. `Route` union in [routes.ts](packages/gui/src/renderer/src/lib/routes.ts)
  includes `projects` with an optional `projectID`.
- Chain: `app.tsx` → `AppRoutes` ([app-routes.tsx:49](packages/gui/src/renderer/src/components/app-routes.tsx:49))
  → `ProjectsRoute` ([app-session-routes.tsx:209](packages/gui/src/renderer/src/components/app-session-routes.tsx:209))
  → `ProjectCollectionPage` ([collection-pages.tsx:151](packages/gui/src/renderer/src/components/collection-pages.tsx:151)).
- `ProjectCollectionPage` owns the search query, `filteredProjects`, and the overview counts memo
  (`{attention, sessions, swarms, views}`, lines 185–191). A `<Show when={activeProject()}>` picks the page:
  - **No `projectID`** → `ProjectsOverview` in [project-directory.tsx](packages/gui/src/renderer/src/components/project-directory.tsx)
  - **`projectID` set** → `ProjectCommandCenter` in [project-command-center.tsx](packages/gui/src/renderer/src/components/project-command-center.tsx)
- Data: `GuiSnapshot` ([store-types.ts:205](packages/gui/src/renderer/src/lib/store-types.ts:205)) with
  `projects: ClientCatalogProject[]` (folders + hydrated `sessions` + `terminalSessions`), plus flat
  `swarms`, `views`, `jobs`, `permissions`, `questions`, `sessionStatus`.
- Derivation helpers already exist and are underused by the UI:
  [project-summary.ts](packages/gui/src/renderer/src/lib/project-summary.ts) — `projectSessionStatus`
  (rolls the whole project up to `dormant | in_progress | input_needed | ready_for_review`),
  `projectAttentionItems` (sessions needing input/review + pending permissions + pending questions +
  failed/interrupted jobs), `projectLatestActivity`, `projectViews`, `projectSwarms`.
- Actions: [project-actions.ts](packages/gui/src/renderer/src/lib/project-actions.ts) (create from folder
  picker, edit name+folders, delete, create-session route), wired through
  [management-actions-controller.ts:102](packages/gui/src/renderer/src/controllers/management-actions-controller.ts:102)
  and the single global promise-based dialog
  ([dialog-controller.ts](packages/gui/src/renderer/src/controllers/dialog-controller.ts) → [dialog-modal.tsx](packages/gui/src/renderer/src/components/dialog-modal.tsx)).

### 1.2 Projects overview ("Workspace directory")

Features today:

- Header: eyebrow "Projects", H1 "Workspace directory", one line of copy, a Create project button.
- Summary strip: five flat chips — Projects / Sessions / Attention / Swarms / Views. Only Attention gets
  a tone, and none of them are interactive.
- A single bordered panel: "N shown" count, search field, and a flat list of rows.
- Rows: folder icon, name, comma-joined folder paths, then a meta column
  (`N sessions · N swarms · N views · relative activity`), then a kebab menu
  (New session / Move up / Move down / Edit / Delete).
- Pointer drag-to-reorder with FLIP animation, drop placeholder, and a portaled drag preview.
- Empty states for "no projects" and "no search match".

Problems:

- **No color, no status.** Rows are hairline-bordered gray. The app already tints Views rows and Dashboard
  cards by `status-*` class, shows `mini-spinner` while running and `status-glyph` for review — projects get
  none of it, even though `projectSessionStatus` and `projectAttentionItems` are computed and ready.
- **The stats are dead weight.** Five identical chips of small numbers; they don't filter, don't navigate,
  don't trend. "Swarms" is a leftover (see §2). "Views" is global trivia, not a decision aid.
- **Rows answer the wrong question.** "12 sessions · 0 swarms · 2 views" doesn't tell you whether anything
  is running or waiting on you. Latest activity is the only signal, and it's the last item in the row.
- **Claude Code is invisible.** Terminal sessions are silently summed into "sessions" both in the strip and
  the row meta.
- **No sorting.** Manual order only; no "recent activity" or "needs attention" ordering.
- **Every project looks identical** — same folder icon, no per-project identity, hard to scan a long list.

### 1.3 Individual project page ("Project home")

Features today:

- Header: back button, eyebrow, project name, folder chips, New session button, kebab
  (Create swarm / Edit / Delete).
- `AttentionQueue` (shared component) for the project's attention items.
- Three collapsible session buckets: **Recent Sessions**, **Prior Sessions** (collapsed by default),
  **Claude Code** (terminal sessions), all rendered as `SessionStatusCard`/`TerminalSessionStatusCard`
  grids with pin/context menus.
- A two-panel split: **Views** (up to 8) and **Swarms** (up to 8, "N roles - N runs").

Problems:

- **The Swarms panel is dead** (§2): `swarm.runs` is the legacy array, so every row reads "0 runs" forever,
  and "Create swarm" per-project contradicts the new model.
- **Claude Code is a third bucket squeezed under "Prior Sessions"** rather than its own clearly-labelled
  section with its own identity (driver badge, directory, resume affordance).
- **The page has no overview of itself** — no per-project stat row, no "2 running · 1 needs input" summary;
  you have to expand buckets and count cards.
- **Folder chips are inert** — no copy path, no open-in-explorer/terminal, no per-folder session start
  (the row action always uses `folders[0]`).
- **Layout is a single column** with a dead CSS grid: `.project-home-layout` defines a 310–380px sidebar
  column that is never used because the component always renders `project-home-layout-single`
  ([project-home-layout.css](packages/gui/src/renderer/src/styles/pages/projects/project-home-layout.css)).
- **No feedback**: create/edit/delete/reorder complete silently (no toast), delete confirm doesn't say what
  is being deleted (session counts), and there are no loading skeletons.

---

## 2. Leftovers to remove (the swarm migration)

Since commit `9e3e574cb4`, a swarm **is a model**: a synthetic `swarm` provider exposes every swarm in the
model picker; selecting one routes the session to the swarm's orchestrator model and delegates the other
roles as subagents inside the same session ([swarm-provider.ts](packages/opencode/src/provider/swarm-provider.ts)).
The Swarms page ([swarms-page.tsx](packages/gui/src/renderer/src/components/swarms-page.tsx)) is now a
catalog/editor for those models. Sessions link to swarms via `session.model.providerID === "swarm"` —
the project association (`swarm.projectID`) is a vestige.

Remove or rework, in the projects surfaces:

| # | Leftover | Where | Action |
|---|----------|-------|--------|
| 1 | "Swarms" panel showing `roles/runs` (`runs` is the dead legacy array — permanently "0 runs") | [project-command-center.tsx:135](packages/gui/src/renderer/src/components/project-command-center.tsx:135) | Delete panel. Optionally replace with a "Models" panel derived from session usage (§4.6) |
| 2 | "Create swarm" project action | [project-command-center.tsx:49](packages/gui/src/renderer/src/components/project-command-center.tsx:49), [creation-actions.ts](packages/gui/src/renderer/src/lib/creation-actions.ts) | Remove from the project kebab; swarm creation lives on the Swarms page |
| 3 | "Swarms" stat chip in the overview strip | [project-directory.tsx:94](packages/gui/src/renderer/src/components/project-directory.tsx:94), counts in [collection-pages.tsx:185](packages/gui/src/renderer/src/components/collection-pages.tsx:185) | Replace with a **Claude Code** chip (terminal session count) |
| 4 | "N swarms" in every overview row's meta | [project-directory.tsx:281](packages/gui/src/renderer/src/components/project-directory.tsx:281) | Remove; replace with split session/Claude Code counts + status (§3.3) |
| 5 | "N swarms" in dashboard project card meta | [dashboard.tsx:248](packages/gui/src/renderer/src/components/dashboard.tsx:248) | Remove |
| 6 | `projectSwarms` feeding `projectLatestActivity` | [project-summary.ts:107](packages/gui/src/renderer/src/lib/project-summary.ts:107) | Drop the swarm term; then `projectSwarms` likely has no remaining project-page callers and can move/die |
| 7 | Stale copy telling the model "start a run from the teams view" | [opencodex_swarm.ts:46,112](packages/opencode/src/tool/opencodex_swarm.ts) | Reword to the model-picker framing |
| 8 | Stale nav description "Create, manage, and run agent swarms" | [navigation-controller.ts:24](packages/gui/src/renderer/src/controllers/navigation-controller.ts:24) | "Build agent teams you can pick as models" |

Out of scope for this pass but worth a follow-up ticket: the dead backend orchestration surface
(`startSwarm` / `assignSwarmTask` endpoints, `swarm-execution.ts` / `swarm-run.ts` / `swarm-reconcile.ts`)
and whether `OpencodeXSwarm.projectID` should become optional.

---

## 3. Redesign — Projects overview

Design references already in the codebase: **Views mission control**
([views-mission-control.tsx](packages/gui/src/renderer/src/components/views-mission-control.tsx) — status-tinted
rows, status dot, hover action cluster, right-aligned signal) and the **Dashboard** card treatment
(`mini-spinner`, `status-glyph`, context + kebab menus). The projects pages should feel like siblings of
those, not like a settings screen.

### 3.1 Page header

- Keep eyebrow/H1/description but tighten copy: H1 **"Projects"** (drop "Workspace directory" — the nav
  already says Projects; the H1 restating a synonym wastes the strongest line on the page).
- Right side: **New session** (primary, accent solid — it's the most frequent action, not Create project)
  and **Create project** (outline). New session opens the existing new-session route.
- Add a live subtitle line driven by real state: "3 projects · 2 sessions running · 1 needs your input" —
  color the "needs your input" fragment with `--warning`. This is the page's heartbeat.

### 3.2 Summary strip → interactive filter chips

Replace the five static chips with four **toned, clickable** chips that filter the list below
(single-select toggle, `aria-pressed`):

| Chip | Value | Tone | Click filters to |
|------|-------|------|------------------|
| Needs attention | `projectAttentionItems` total | `warning` (danger if any failed job) | projects with attention items |
| Running | count of projects with `in_progress` status | `info` + subtle pulse while > 0 | projects with a running session |
| Sessions | chat session count | neutral | — (display only) |
| Claude Code | terminal session count | `special` (purple) with the Claude Code badge styling | projects with terminal sessions |

Implementation: extend the counts memo in `collection-pages.tsx:185` (split `sessions` vs
`terminalSessions`, add `running`), pass a `filter` signal down. Chips use `CountBadge`/`StatusBadge`
tokens (`--ds-*-soft` backgrounds) so the strip finally carries color.

### 3.3 Rows

Rebuild `ProjectDirectoryRow` on the views-row pattern:

- **Identity glyph**: replace the uniform folder icon with a colored initial tile (`identityInitials` +
  a stable hue hashed from `project.id`, same trick as `AgentGlyph`). Instant scannability and the main
  source of per-row color.
- **Status dot + row tint**: apply `status-{projectSessionStatus()}` to the row like
  `view-summary-row` does — inset accent bar + soft `color-mix` background for `input_needed`,
  `ready_for_review`, `in_progress`. Add `mini-spinner` when running and `status-glyph` when review-ready
  (both primitives exist).
- **Line 1**: name + optional `CountBadge` "2 need input" (warning tone).
- **Line 2**: folder paths (compact, middle-truncated, `title` tooltip) — unchanged idea, better truncation.
- **Meta column**, rebuilt: `▣ 4 sessions · ◆ 2 Claude Code · active 5m ago`. Sessions and Claude Code
  are separate labeled counts (leftover #4 removed). "Views" leaves the row — it's discoverable on the
  project page.
- **Hover action cluster** replacing the always-kebab: on hover/focus-within reveal
  `New session` (icon), `Open` — kebab keeps Move up/down, Edit, Delete. Matches the views page pattern.
- **Keyboard**: rows focusable, Enter opens, `Ctrl+↑/↓` reorders (announce via `aria-live`), menu already
  covers no-pointer reorder.

### 3.4 Sorting, search, list organization

- **Sort control** (`SegmentedControl`, right of search): **Custom** (manual order, default) /
  **Activity** (`projectLatestActivity` desc) / **Attention first**. Drag handles only shown in Custom.
- Search: use the shared `SearchField` (with clear button) instead of the bare `TextInput`; also match
  session titles, not just names/folders, and show "N of M" when filtering.
- Optional grouping when list ≥ ~8: pinned/active projects above a hairline "Quiet" divider
  (no activity in 7 days), mirroring the recent/prior split users already know from sessions.

### 3.5 Empty & edge states

- First-run empty state: use the `EmptyState` primitive with the identity-glyph illustration, two actions
  (Create project / New session in a temp directory), one sentence of value copy.
- Search-empty keeps the current pattern but adds a one-click "Clear search".
- Skeleton rows (`Skeleton` primitive) while the snapshot is bootstrapping instead of flashing empty.

---

## 4. Redesign — Individual project page

### 4.1 Header

- Identity glyph (same hue as the overview row) beside the H1 — the pages visually connect.
- Status pill next to the name driven by `projectSessionStatus` ("2 running", "needs input", "idle") using
  `StatusPill`.
- **Folder chips become useful**: each chip gets a hover cluster — copy path, reveal in Explorer, new
  session *in this folder* (fixes the `folders[0]` hardcode at
  [project-command-center.tsx:69](packages/gui/src/renderer/src/components/project-command-center.tsx:69)).
  An "Add folder" ghost chip opens the existing edit dialog.
- Kebab: Edit project / Delete project (Create swarm removed, leftover #2).

### 4.2 Stat row (new)

Four compact stat chips under the header, same component as §3.2 but project-scoped, doubling as
scroll anchors: Attention · Running · Sessions · Claude Code. Gives the page an at-a-glance state and
its own dose of color.

### 4.3 Attention queue

Keep `AttentionQueue` first — it's the strongest element on the page. Improvements:

- Show source icons per item (permission lock, question mark, failed-job warning) and tone the row by
  item tone (`danger` for failed jobs is already in the data, currently flattened).
- Add inline resolution where cheap: "Open" is today's behavior; add "Approve"/"Deny" for permission
  items when the permission API allows acting outside the session view (else keep Open only).

### 4.4 Sessions area

- **Recent / Prior buckets stay**, with two fixes: bucket headers get count badges with tone (warning when
  a bucket contains attention sessions), and "Prior" gets a "Show all N" paginator instead of rendering
  every card.
- Cards already carry status classes/spinner/glyph — no change needed there.

### 4.5 Claude Code section (new, first-class)

Pull terminal sessions out of the bucket stack into a **dedicated section** with its own header:

- Header: Claude Code wordmark-style label + `special` tone accent (the purple already used for the
  Claude Code `StatusBadge`), count, and a **"Launch Claude Code"** action (new terminal session in the
  primary folder — today there is no way to start one from this page).
- Cards: `TerminalSessionStatusCard` stays, but surface `directory` and `resumeID` state distinctly:
  "resumable" vs "running" vs "stale", and show the driver badge on the card (already done) plus relative
  launch time.
- Section renders only when the project has (or can have) terminal sessions; empty state offers the
  Launch action rather than the passive "No Claude Code sessions."

### 4.6 Panels: Views + Models

- **Views panel stays** (it's real: views spanning this project's sessions), upgraded to the mission-control
  row treatment: status dot from `deriveViewStatus`, pane count, "Open" on hover.
- **Swarms panel is replaced by a "Models" panel** (optional, small): distinct `session.model` values used
  by this project's sessions, rendered with `ModelBadge` — swarm-models included, giving swarms their
  correct new appearance ("this project mostly runs on `sonnet-5` and the *Reviewers* swarm"). Clicking a
  swarm model opens the swarm editor. If this feels like scope creep, ship the panel deletion first;
  the Models panel is additive.
- Revive the dead sidebar column in `.project-home-layout` for these panels on wide viewports
  (≥1200px): main column = attention + sessions, sidebar = stat chips + Views + Models. Below that,
  single column as today. (Alternative: delete the sidebar CSS. Reviving it is preferred — the page is
  currently a long single column with poor wide-screen use.)

### 4.7 Feedback everywhere

- **Toasts** (`useToast`, already in the barrel) for: project created (with name), project updated,
  project deleted (with undo if cheap — recreate from held folders/name), session created, Claude Code
  launched, reorder saved.
- **Delete confirm says what dies**: "Delete *opencodex*? 12 sessions and 3 Claude Code sessions will be
  removed from this catalog." (counts from the hydrated project).
- **Create flow gains a name step**: today `runCreateProjectAction` derives the name from the folder path
  with no edit opportunity; reuse the existing `askProject` dialog pre-filled after folder pick.
- Optimistic reorder already exists (FLIP + move animation) — keep, add the `aria-live` announcement.

---

## 5. Code & style cleanup

### 5.1 Delete orphaned CSS (~500 lines)

Classes appear in no `.tsx`; verify with a grep per class before deleting each file in
`styles/pages/projects/`:

- `project-metric.css`, `project-cards.css`, `project-card-states.css`, `project-detail-list.css`,
  `project-detail-row.css`, `project-detail-row-states.css`, `project-detail-row-copy-states.css`,
  `project-directory-copy.css`, `project-view-header.css`, `project-rail-rows.css`
- Unused selectors inside live files: `.project-command-header` / `.project-command-detail-header`
  in [project-command-page.css](packages/gui/src/renderer/src/styles/pages/projects/project-command-page.css)
- Remove the matching `@import` lines from `styles.css`.

### 5.2 Deduplicate the drag-reorder machinery

Three ~80-line copies of the same pointer-drag + FLIP routine:
[project-directory.tsx:144](packages/gui/src/renderer/src/components/project-directory.tsx:144),
[views-mission-control.tsx:150](packages/gui/src/renderer/src/components/views-mission-control.tsx:150),
and the rail. Extract `lib/pointer-reorder.ts` (`createPointerReorder({rowSelector, onReorder})`
returning drag state signals + the FLIP animator) and use it in all three. Also unify the two
`ProjectDragPreview` components ([project-directory.tsx:288](packages/gui/src/renderer/src/components/project-directory.tsx:288)
vs [rail-project-drag-preview.tsx](packages/gui/src/renderer/src/components/rail-project-drag-preview.tsx)).

### 5.3 Misc

- Remove the unused `CollectionPage` export ([collection-pages.tsx:255](packages/gui/src/renderer/src/components/collection-pages.tsx:255)).
- Deduplicate `.project-home-panel` CSS (verbatim copy of `.project-directory-panel` in
  [project-directory-panel.css](packages/gui/src/renderer/src/styles/pages/projects/project-directory-panel.css)).
- Fix leftovers #7/#8 (stale swarm copy in the tool prompt and nav description).
- New CSS follows the token system (`--ds-*`, tone `-soft` variants, `data-tone` attributes) — no new
  hex values; hue for identity glyphs computed from tokens or an OKLCH ramp added to the theme files.

---

## 6. Sequencing

| Phase | Scope | Size |
|-------|-------|------|
| **1. Leftovers** | §2 items 1–8, §5.3 copy fixes. Pure removal + count rewiring. | S |
| **2. Overview redesign** | §3: header, filter chips, row rebuild (identity glyph, status tint, hover actions), sort, search, empty/skeleton states. | L |
| **3. Project page redesign** | §4: header + stat row, Claude Code section, folder chip actions, Views panel upgrade, sidebar layout revival, (optional) Models panel. | L |
| **4. Feedback** | §4.7: toasts, delete-confirm counts, create-name step, aria-live. | M |
| **5. Debt** | §5.1 orphan CSS deletion, §5.2 drag dedupe, `CollectionPage` removal. | M |

Phases 1 and 5 are safe to land immediately and independently. 2 and 3 should each land as one visual
change with screenshots.

## 7. Verification

- Unit/functional: update [project-view-workflows.test.ts](packages/gui/test/functional/project-view-workflows.test.ts)
  and [project-actions.test.ts](packages/gui/test/project-actions.test.ts) for the count changes (split
  sessions/Claude Code, no swarms), the name step in create, and delete-confirm copy.
- Visual: run the app, verify both pages in dark **and** light themes, at 1000px / 1280px / 1600px widths,
  with 0, 1, and 15+ projects; verify status tints with a running session, a pending permission, and a
  failed job.
- A11y: keyboard-only pass (row focus, Enter to open, menu reorder, chip toggling announces state),
  `prefers-reduced-motion` disables FLIP + pulse.
