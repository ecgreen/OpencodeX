# OpencodeX GUI Sidecar

Packaged desktop builds copy the existing `opencode`/`opencodex` CLI binary into this directory as an Electron resource.

The GUI launches that binary with:

```sh
opencodex internal-tui-coordinator <directory> --key <coordinator-key>
```

The coordinator publishes a local manifest with its loopback URL and generated credentials. The Electron main process reads that manifest, injects HTTP Basic Auth only for the sidecar origin, and keeps a short-lived GUI client lease so stale coordinators can be cleaned up safely.

All data access stays behind the existing HTTP/SSE API and generated SDK. The GUI must not read or write backend SQLite files directly.
