# OpencodeX AAA GUI design audit

Version: recovery and direction gate, 2026-07-14. The current branch and working tree are the only baseline.

## System evidence

- The renderer imports 48 authored CSS files containing about 15,857 lines and 457 raw color declarations.
- The component tree contains 170 raw buttons and 24 raw inputs alongside 67 shared button and 16 shared input usages.
- Page geometry and primitive styling are still order-dependent across token, polish, terminal-native, and Precision layers.
- The approved replacement direction is intentionally undecided until the three concepts in the development-only Design System Lab are reviewed.

## Recovery register

| ID | Surface | Severity | Evidence and impact | Acceptance | Status |
| --- | --- | --- | --- | --- | --- |
| AAA-001 | Dashboard | P1 | A standalone attention surface became a third child of a two-row fixed dashboard grid and collided with the four primary modules. | Exactly four in-flow modules have positive geometry, pointer access, and zero pairwise overlap at every supported viewport. | Verified by guarded Chromium geometry. |
| AAA-002 | Rail | P1 | A dynamic numeric badge participated in navigation layout and shifted labels and controls. | No numeric rail badge is rendered and attention changes cannot change rail geometry. | Verified by guarded Chromium geometry. |
| AAA-003 | Session inspector | P2 | The lazy workspace-tools boundary rendered raw text without preserving final panel structure. | A delayed structural panel loading state preserves geometry, announces activity, and disables motion when requested. | Implemented; shared loading fixture passes the approval matrix. |
| AAA-004 | Embedded browser | P1 | Native creation and bounds were started independently; host mounting did not trigger an awaited create/show sequence. | One shared lifecycle owns create, navigate, bounds, hide, stale results, errors, and destruction for both browser presentations. | Deterministic lifecycle tests and development Electron acceptance pass; packaged matrix pending. |
| AAA-005 | Native browser containment | P1 | Hidden WebContentsViews remained attached to the window content tree and could outlive their visible route. | Inactive views are detached; destroyed views close their WebContents; active bounds match the DOM host within one pixel. | Development Electron one-pixel geometry and route-hiding checks pass; packaged matrix pending. |
| AAA-006 | Shared controls | P1 | Shared text inputs had no complete height, padding, focus, disabled, placeholder, or invalid contract. | Shared inputs render consistent geometry and states across manager and Workbench surfaces. | Verified by guarded Chromium geometry. |
| AAA-007 | Empty states | P1 | A late generic dashboard-card rule set Swarm and View empty-create padding to zero. | Empty-create cards retain at least 14px internal padding and one clear action. | Verified for View and Swarm empty states by guarded Chromium geometry. |
| AAA-008 | Manager alignment | P2 | Views began at an 18px internal inset while Swarms, Projects, and Plugins inherited unrelated stage and page padding. | All four manager indexes share an 18px effective top inset. | Verified by guarded Chromium page-header geometry. |
| AAA-009 | Global CSS ownership | P1 | Multiple late layers redefine the same cards, controls, statuses, and page roots. | After direction approval, global CSS is limited to tokens, base, primitives, layout, utilities, and bridges; feature styling is locally owned. | Backlog for Foundation train. |
| AAA-010 | Primitive adoption | P1 | Most renderer controls bypass the existing primitive set. | Raw interactive controls remain only on a documented native-semantics allowlist. | Backlog for Foundation and page trains. |

## Approval matrix

The Design System Lab renders identical Dashboard, active Session, Browser, dialog, loading, empty, and recovery fixtures for Instrument-grade, Spatial desktop, and Technical editorial concepts.

Required evidence before selection:

- 980×680, 1180×800, 1440×960, and 1920×1080;
- dark and light themes;
- default and reduced motion;
- six static 1440×960 concept/theme references;
- one interaction recording covering direction, theme, navigation, and keyboard focus;
- no operating-system pointer or keyboard automation; visual runs use one guarded host browser or Electron application at a time.

## Validation status

- Passed: GUI typecheck, 306 unit tests, source-size enforcement, production build, Husky staged-diff check, full working-tree EOF scan, `git diff --check`, guarded Chromium recovery geometry, the 48-state direction matrix, interaction recording, host GPU validation, and development Electron native-view acceptance.
- Pending: the packaged Electron native-view matrix on Windows, Linux, and macOS and app-wide approved-golden comparison.
- Safety: each host run used one Playwright worker and one Chrome or Electron application, two CPU cores, below-normal priority, GPU acceleration, a 2.5 GB cutoff, and explicit cleanup. Peak Chrome memory was 1.05 GB; peak Electron memory was 625 MB. No operating-system mouse or keyboard automation ran.

## Ranked post-approval backlog

1. Establish cascade layers and canonical foundation/semantic tokens for the selected direction.
2. Complete and enforce shared primitive APIs and remove superseded global rules during migration.
3. Migrate the flagship rail, Dashboard, Session, loading, and Browser slice and request a second approval.
4. Migrate manager pages, then daily-driver Workbench surfaces, then global system states.
5. Close the cross-platform packaged native-view, accessibility, performance, memory, and visual-regression gates.
