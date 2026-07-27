# OpencodeX GUI Sidecar

Packaged desktop builds copy the dedicated `opencode-gui-coordinator` binary into this directory as an Electron resource.

The GUI launches that binary with:

```sh
opencode-gui-coordinator <directory> --key <coordinator-key>
```

The coordinator publishes a local manifest with its loopback URL and generated credentials. The Electron main process reads that manifest, injects HTTP Basic Auth only for the sidecar origin, and keeps a short-lived GUI client lease so stale coordinators can be cleaned up safely. It uses the same startup lock and manifest as TUI launches, so concurrent GUI and TUI starts converge on one server.

All data access stays behind the existing HTTP/SSE API and generated SDK. The GUI must not read or write backend SQLite files directly.
