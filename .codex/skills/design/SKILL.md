---
name: design
description: Audit, plan, implement, and visually validate polished OpencodeX GUI or TUI interface work. Use for UI/UX reviews, visual redesigns, component styling, navigation changes, responsive behavior, accessibility, motion, typography, colors, design-system changes, or screenshot-based interface QA. Enforce the approved Instrument-grade direction, progressive disclosure, repository modularity, and isolated browser validation.
---

# OpencodeX Design

Apply the Instrument-grade GUI language without changing product behavior or information architecture by accident. The canonical GUI specification is [packages/gui/docs/GUI_DESIGN_SYSTEM.md](../../../packages/gui/docs/GUI_DESIGN_SYSTEM.md).

## Start with evidence

1. Use Graphify for architectural orientation, then verify the owning components and styles in source.
2. State the user task, current friction, existing actions, information hierarchy, and affected states before editing.
3. Read [packages/gui/docs/GUI_DESIGN_SYSTEM.md](../../../packages/gui/docs/GUI_DESIGN_SYSTEM.md) before changing GUI visual code. Use [references/opencodex-design-system.md](references/opencodex-design-system.md) only as a concise skill index.
4. Read [references/review-checklist.md](references/review-checklist.md) before implementation and again before handoff.
5. Preserve the centralized transcript-scroll contract and existing Git comparison behavior.

## Protect the product structure

- Keep existing routes, shortcuts, features, and state ownership unless the user explicitly authorizes a product change.
- Do not add permanent navigation, settings, panels, or visible actions merely to make a surface appear richer.
- Allow one primary action per region. Move secondary and destructive actions into hover/focus affordances, context menus, or overflow menus.
- Do not expose the same operation through multiple nearby controls.
- Prefer shared tokens and primitives when a pattern repeats. Keep surface-specific layout close to its owning component.
- Keep source files below 500 lines and split only at genuine visual or operational boundaries.

## Work in approval slices

1. Restore or capture a trustworthy baseline.
2. Implement the smallest representative vertical slice.
3. Verify empty, populated, loading, error, keyboard, narrow, wide, dark, light, default-motion, and reduced-motion states.
4. Capture screenshots and motion evidence in the isolated GUI test harness.
5. Stop for explicit approval before applying the direction to additional pages.
6. Add only approved captures to future reference assets or snapshot baselines.

## Validate without touching host input

- Use one in-app browser or the isolated repository harness. Never run more than one GUI test application.
- Never launch uncontrolled host Electron, Chrome, Edge, Playwright, computer-use, or input automation.
- Never move, capture, confine, or otherwise control the host pointer or keyboard.
- Keep CPU, memory, process, and worker counts bounded and clean up the application after validation.
- If neither the in-app browser nor isolated infrastructure is available, report the visual gate as blocked.
- Run package-scoped static checks and non-browser tests with restrained concurrency.

## Reject a design when

- persistent control count increases without a mapped user task;
- primary content loses space to chrome or decoration;
- selection, focus, or status depends on color alone;
- motion creates layout shift, delays input, or ignores reduced motion;
- raw page-local colors, radii, shadows, or duplicated button rules bypass the shared system;
- hover-only actions are unavailable to keyboard users;
- the result looks busier at the minimum supported viewport.
