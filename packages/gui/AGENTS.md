# OpencodeX GUI Standards

These instructions apply to `packages/gui`. Read [docs/GUI_DESIGN_SYSTEM.md](docs/GUI_DESIGN_SYSTEM.md) before
changing renderer presentation or interaction.

## Design-system boundary

- Import application controls only from `src/renderer/src/components/ui`.
- Do not add raw `button`, visible `input`, `textarea`, or `select` elements outside primitive implementations or
  documented platform-native cases such as hidden file pickers.
- Use `Button` appearance/tone/size props and semantic tokens. Never pass raw colors from a page.
- Use `Select` for choosing values and `Menu`/`DropdownMenu` for actions.
- Pages arrange primitives. They do not redefine primitive padding, radius, focus, hover, loading, disabled,
  destructive, or selected states.
- A region has one primary action. Progressively disclose secondary and destructive operations without removing
  their keyboard path.

## CSS ownership

- Raw application colors belong only in `styles/themes/dark.css` and `styles/themes/light.css`; approved editor,
  terminal, and plugin theme data are the only documented exceptions.
- Consume `--theme-*` tokens from features and pages; declare them only in the canonical theme files.
- Global CSS is limited to tokens, reset/base, primitives, shell/layout, accessibility utilities, and bridges.
- Shared component, shell, and overlay rules live under `styles/global`; page rules live under their matching
  `styles/pages/<surface>` owner. Component-local CSS Modules remain appropriate for isolated new features.
- Feature modules may set placement and dimensions but may not target primitive internals.
- Never define the same selector in multiple files under the same at-rule context.
- Never use `!important` outside the reduced-motion accessibility boundary in `design-base.css`.
- Delete superseded selectors in the same migration. Do not add correction, polish, vNext, or terminal-native
  layers.
- Respect the cascade layers declared by `styles.css`.

## Interaction and accessibility

- Meet WCAG 2.2 AA and communicate state without color alone.
- Icon-only controls require an accessible label and tooltip. Targets are 28-32px and never below 24px.
- Preserve visible focus, logical Tab order, Escape behavior, dialog semantics, and focus restoration.
- Loading, error, validation, and asynchronous content must reserve stable geometry.
- Support reduced motion. Infinite animation is allowed only for genuine activity.

## Layout and ownership

- Every route uses a manager-page or full-bleed layout contract and has one intentional scroll owner per region.
- Keep components/controllers logically owned and side effects at explicit lifecycle boundaries.
- Authored TS, TSX, and CSS files must stay below 500 lines; new modules normally stay below 400.
- Reuse shared selectors, status presentation, and commands instead of copying business logic.
- Preserve the centralized transcript-scroll behavior and existing Git comparison experience exactly.
- Treat the current working tree as the visual baseline. Do not compare GUI design against `main`.

## Guarded validation

- Run visual work in one in-app browser or the isolated repository harness: one Chrome or Electron application,
  one worker, bounded CPU and memory, with GPU acceleration where the environment supports it.
- Clean up every spawned browser/Electron process.
- Never control, capture, confine, or automate the host mouse or keyboard.
- If isolated visual infrastructure is unavailable, report the visual gate as blocked; do not fall back to host
  automation.
- Run `bun run check:design-system`, `bun run check:source-size`, relevant tests, typecheck, build, the read-only
  Husky hook, and `git diff --check` for design-system changes.
