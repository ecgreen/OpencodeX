# OpencodeX GUI Sidecar

Packaged desktop builds copy the existing `opencode`/`opencodex` CLI binary into this directory as an Electron resource.

The GUI launches that binary with:

```sh
opencodex serve --hostname 127.0.0.1 --port 0
```

All data access stays behind the existing HTTP/SSE API and generated SDK. The GUI must not read or write backend SQLite files directly.
