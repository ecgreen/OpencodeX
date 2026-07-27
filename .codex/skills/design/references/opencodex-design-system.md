# OpencodeX Instrument-grade Design System

The canonical, versioned specification is
[packages/gui/docs/GUI_DESIGN_SYSTEM.md](../../../../packages/gui/docs/GUI_DESIGN_SYSTEM.md). Read that document before
changing GUI presentation. Do not copy its token or component rules into this skill.

Use this index while routing work:

- Foundation: `packages/gui/src/renderer/src/styles/themes/foundation.css`.
- Dark theme and aliases: `packages/gui/src/renderer/src/styles/themes/dark.css`.
- Light theme overrides: `packages/gui/src/renderer/src/styles/themes/light.css`.
- Base and accessibility: `packages/gui/src/renderer/src/styles/design-base.css`.
- Primitive visuals: `packages/gui/src/renderer/src/styles/design-primitives.css`.
- Global/page ownership: `packages/gui/src/renderer/src/styles/global` and `styles/pages`.
- Adapter API: `packages/gui/src/renderer/src/components/ui`.
- GUI coding rules: `packages/gui/AGENTS.md`.
- Review procedure: `review-checklist.md`.

Instrument-grade means matte graphite surfaces, Geist typography, restrained warm focus/selection/action accent,
semantic status colors, a 4px grid, compact control geometry, and purposeful reduced-motion-aware transitions.
The current working tree is the product baseline; do not compare visual direction with `main`.
