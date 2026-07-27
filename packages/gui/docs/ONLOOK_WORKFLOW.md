# Onlook Preview Workflow

Use Onlook as a visual review surface for the GUI renderer while keeping implementation in Solid/Vite.

## Preview Target

Run the renderer from the repo root:

```powershell
bun --cwd packages/gui run onlook:preview
```

Then point Onlook at:

```text
http://127.0.0.1:5173
```

## Guardrails

- Preserve the sidebar/main-area layout.
- Keep sessions and views as cards in the sidebar and dashboard.
- Keep the terminal-native density, monospace rhythm, and TUI conceptual model.
- Prefer changes to `src/renderer/src/styles.css` and local `src/renderer/src/components/ui` primitives before touching stateful app logic.
- Use Onlook for visual iteration, spacing checks, and decluttering notes; commit source changes through the repo, not generated one-off rewrites.
