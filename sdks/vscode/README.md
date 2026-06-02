# OpencodeX VS Code Extension

A local development extension for opening the OpencodeX TUI inside VS Code's integrated terminal.

## Features

- **Quick Launch**: Use `Cmd+Esc` on macOS or `Ctrl+Esc` on Windows/Linux to open or focus OpencodeX.
- **New Session Tab**: Use `Cmd+Shift+Esc` on macOS or `Ctrl+Shift+Esc` on Windows/Linux to start another OpencodeX terminal.
- **Context Awareness**: When a file is active, the extension appends an `@file` reference to the OpencodeX prompt after startup.
- **File Reference Shortcut**: Use `Cmd+Option+K` on macOS or `Ctrl+Alt+K` on Windows/Linux to append the current file or selection.

## Local Testing

1. Open this folder in VS Code:

   ```sh
   code sdks/vscode
   ```

2. Press `F5` to launch an Extension Development Host.

3. In the Extension Development Host, run `OpencodeX: Open OpencodeX` from the command palette or press `Cmd+Esc` / `Ctrl+Esc`.

## Local VSIX Install

To test the extension as a normal installed VS Code extension instead of using F5:

```powershell
cd C:\Work\OpencodeX\sdks\vscode
npx @vscode/vsce package --no-dependencies
code --install-extension .\opencodex-0.0.1.vsix --force
```

After installing, run your normal OpencodeX CLI build/install flow from the repo root:

```powershell
cd C:\Work\OpencodeX
.\build-and-install.ps1
```

Then open VS Code normally and run `OpencodeX: Open OpencodeX` from the command palette.

## Settings

The extension launches `opencodex --port <port>` by default. For local testing, set `opencodex.command` to whichever shell command starts your local OpencodeX build.

Examples:

```json
{
  "opencodex.command": "opencodex"
}
```

```json
{
  "opencodex.command": "wsl opencodex"
}
```

If your command needs extra arguments before `--port`, use:

```json
{
  "opencodex.command": "wsl opencodex",
  "opencodex.arguments": ["--some-local-flag"]
}
```

## Development Notes

- The extension is intentionally thin: it opens the TUI in a terminal and sends context over the existing `/tui/append-prompt` endpoint.
- The local F5 flow loads `dist/extension.js` directly and does not run Bun, typecheck, lint, or the CLI build.
- Local VSIX packaging also uses the checked-in `dist/extension.js` bundle instead of rebuilding.
- Publishing metadata is not final. This package is currently set up for local testing first.
