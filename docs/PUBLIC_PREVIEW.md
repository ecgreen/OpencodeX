# OpencodeX Public Preview Notes

OpencodeX public preview releases are distributed from GitHub Releases. The TUI/CLI is the primary supported surface; the desktop GUI is available as preview-quality release assets.

## Install Surface

- CLI assets are named `opencodex-<platform>-<arch>` and are installed by the root `install` and `install-windows.ps1` scripts.
- GUI assets are built by Electron Builder and uploaded by the `release-gui` workflow.
- Public GUI preview builds are expected to be signed on Windows and signed/notarized on macOS. Unsigned GUI builds are for internal preview testing only and must be called out in release notes if published.
- Checksums are published as `SHA256SUMS` for CLI assets and `SHA256SUMS-GUI` for GUI assets.

## Known Preview Limitations

- The TUI remains the source of truth for the complete workflow set.
- GUI plugin installation is currently surfaced as unavailable unless a backend endpoint exists.
- GUI desktop installers do not yet include auto-update.
- GUI releases are GitHub Release assets only; package managers and app stores are out of scope for preview.
- Unsigned GUI builds can require manual approval in operating-system security dialogs.

## Data And Compatibility

- TUI and GUI use the same opencode session store and backend APIs.
- The GUI launches a packaged `opencode` sidecar coordinator over loopback with generated Basic Auth credentials.
- The GUI must not read or write backend SQLite files directly.
- Existing upstream opencode sessions, providers, MCP servers, plugins, themes, and SDK integrations should continue to work.

## Release Validation Checklist

- Run package-level typecheck and tests for `packages/opencode` and `packages/gui`.
- Run `packages/opencode` HTTP API exerciser gates.
- Build CLI release assets and verify `opencodex --version`.
- Build GUI unpacked assets, run packaged GUI smoke, then build distributable desktop assets.
- Install CLI and GUI artifacts on Windows, macOS, and Linux from GitHub Releases.
- Validate new session, project session, view create/edit, prompt history, permission/question, diff review, model switching, MCP/LSP status, concurrent sessions, and TUI/GUI interop.

## Reporting Issues

Use the GitHub issue template that matches the failure:

- Install failure
- GUI sidecar failure
- TUI rendering issue
- Provider/model issue
- General bug report

Include the OpencodeX version, operating system, install method, and the smallest set of reproduction steps that shows the problem.
