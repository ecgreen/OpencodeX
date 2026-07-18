# Containerized GUI testing

Run Chromium GUI tests only through the isolated container harness:

```powershell
bun run test:e2e:container
```

The harness copies the current working tree into an ephemeral Linux Playwright container. The test container:

- has no host display, input devices, or published ports;
- is limited to two CPU cores, 3 GB of memory, and 256 processes;
- uses one Playwright worker and a 512 MB shared-memory allocation;
- runs with all Linux capabilities dropped and an ephemeral container filesystem;
- writes only `packages/gui/.artifacts` back to the workspace;
- is removed automatically after the run.

The pinned Playwright image and locked dependencies are downloaded inside the Docker boundary. Dependency installation and Chromium execution share the same resource ceiling. The application exposes no host ports; its renderer and disposable backend communicate over container loopback. Pass Playwright file paths after `--` to run a focused slice:

```powershell
bun run test:e2e:container -- e2e/layout.spec.ts
```

This harness covers Chromium renderer behavior and visual geometry. It does not replace platform-specific Electron coverage for native views, window behavior, or operating-system integration.
