# Multi-Client Reliability Tracker

Last updated: 2026-08-12

## Goal

Make one canonical LAN/Tailscale `opencodex serve` backend reliable for TUI, GUI, and future mobile clients across connection loss, process restart, missed streaming events, pending permissions, and uncertain prompt responses.

## Architecture Decision

- The LAN/Tailscale `opencodex serve` process is the authoritative backend and writer.
- TUI uses remote attach instead of starting a second local coordinator for shared sessions.
- GUI gains an explicit remote-backend mode instead of always starting or authorizing a loopback sidecar.
- Mobile connects directly to the canonical backend and conforms to the same state and mutation contracts.
- `/state/event` plus authoritative snapshots is the reliable reconciliation path.
- `/global/event` is best-effort live fanout. A client using it must refetch authoritative state after reconnect until resumable replay is implemented.
- One stable `messageID` represents one logical prompt and must survive transport retries.

## Incident Evidence

- Two server processes listened on port 4096 while sharing SQLite but not their process-local `GlobalBus`.
- The affected session had no workspace attachment, so no hub bridge joined those event buses.
- The reported "design doc" prompt existed once in SQLite but its durable command reached `claim_generation = 3`.
- Permission and message events share the stream, while permission requests remain durable in `session_interaction`.
- Both event streams emit 10-second heartbeats; no server-side SSE idle timeout was found.

## Work Items

### MCR-1: Canonical Backend Operations

Status: in progress; health identity implemented locally

Document and validate one authoritative `opencodex serve` process bound to the Tailscale or intended LAN interface. Prevent unsupported shared-database, process-local-fanout deployments from appearing healthy.

Acceptance criteria:

- One documented startup command and credential source exists.
- TUI, GUI, and mobile connection URLs resolve to the same server health identity.
- Diagnostics expose process identity, backend role, database identity, and event-bus identity. Implemented locally.
- A warning is emitted when multiple server processes use one database without a configured bridge.
- Loopback coordinator and wildcard hub port collisions are diagnosed explicitly.

### MCR-2: Durable Prompt Recovery

Status: implemented locally in `116a82f`; broader cross-process E2E pending

Prevent a standby process from replaying an actively leased external turn while preserving explicit recovery after owner failure.

Acceptance criteria:

- A valid foreign command lease is never stolen by an armed recovery waiter.
- Command heartbeat runs while waiting for the session execution turn.
- Expired predecessors are reclaimed before newer queued commands.
- One later recovery pass reclaims a command after its lease expires.
- A two-process test proves one command produces one external-model execution.

### MCR-3: Reconnect Reconciliation Contract

Status: pending

Make the supported reconnect sequence explicit and enforceable for every client.

Acceptance criteria:

- On connect, the client loads an authoritative catalog and visible-session state.
- On reconnect, `/state/event` resumes after the last cursor or requests a full reset.
- Missed transient assistant deltas converge to the persisted final transcript.
- Pending permissions and questions are reconciled from authoritative state.
- A client never treats reconnect success as state convergence until reconciliation completes.
- `/global/event`-only clients perform a catalog and visible-session refetch after every reconnect.

### MCR-4: Prompt Idempotency Lifecycle

Status: pending

Carry one `messageID` from user submission through retries, app suspension, and uncertain responses.

Acceptance criteria:

- GUI and TUI retain the original `messageID` after an uncertain transport failure.
- Re-submitting an unchanged restored draft reuses that ID.
- Editing or starting a new logical prompt creates a new ID.
- Mobile persists pending submissions and their IDs until server acceptance is confirmed.
- The server stores one user message and one command for repeated requests with the same ID.

### MCR-5: GUI Remote Backend Mode

Status: implemented locally; packaged smoke against a deployed canonical backend pending

Allow desktop GUI to use the canonical backend without spawning a loopback coordinator.

Acceptance criteria:

- GUI accepts an explicit canonical URL and credentials.
- Main-process authorization and renderer CSP allow only that configured origin plus existing loopback development origins.
- Remote mode does not spawn or acquire a local coordinator.
- Connection errors identify the configured backend and preserve retryable state.
- Local sidecar mode remains available for standalone use.

Runtime configuration:

- `OPENCODEX_GUI_SERVER_URL`: canonical origin. HTTPS is required for non-loopback hosts by default.
- `OPENCODEX_GUI_SERVER_USERNAME`: Basic-auth username, default `opencode`.
- `OPENCODEX_GUI_SERVER_PASSWORD`: Basic-auth password. An empty value sends no authorization header.
- `OPENCODEX_GUI_DIRECTORY`: canonical backend directory used for initial routing.
- `OPENCODEX_GUI_ALLOW_INSECURE=1`: explicit opt-in for trusted HTTP LAN/Tailscale development.

Remote mode authorizes only the exact configured origin, adds only that origin to renderer CSP, returns no credentials through preload, and does not start, lease, restart, or stop a local coordinator. Credential rotation currently requires an app restart.

### MCR-6: TUI Canonical Attach

Status: existing command, operational/default integration pending

Use `opencodex attach <url>` as the canonical shared-session path and make accidental local-coordinator use visible.

Acceptance criteria:

- Document canonical attach command, directory routing, and credential environment variables.
- TUI displays whether it is connected to a coordinator or canonical serve backend.
- Reconnect preserves origin, credentials, cursor, pending prompt ID, and visible-session reconciliation.
- Starting a local coordinator while a canonical backend is configured requires an explicit standalone choice.

### MCR-7: Deterministic Multi-Client E2E

Status: in progress; canonical prompt, reconnect, permission, and restart contracts implemented locally

Add a real `opencodex serve` subprocess suite using mobile-like SDK clients.

Acceptance criteria:

- Prompt submitted by client A appears once to connected client B.
- A disconnected client converges by authoritative refetch after missing events.
- Pending permission is recoverable by a newly connected client.
- Server restart preserves transcript, permission, and command state.
- Shared-database/two-process behavior is tested and documented as unsupported without a bridge.
- Expired command recovery produces one external-model execution.
- Tests use readiness signals and OS-assigned ports rather than fixed sleeps or port 4096.

Implemented coverage:

- Raw mobile-like client receives one correlated live prompt event.
- The same client disconnects, misses a prompt, reconnects, and converges by transcript refetch.
- A pending permission is recovered and settled after the event subscriber disconnects.
- Transcript and pending permission survive a canonical backend restart on one SQLite file.
- Requests after restart use the canonical session directory returned by the server rather than a client-side path alias.

### MCR-8: Client-Agnostic Mobile Conformance

Status: ready for assignment after a mobile repository is selected

The mobile client must conform to the canonical backend rather than define an independent synchronization model.

Acceptance criteria:

- Explicit canonical server URL; never silently default to device loopback.
- Retain the canonical session directory returned by the server for subsequent routed requests.
- Persist and resume the authoritative state cursor.
- Handle reset-required by loading a fresh snapshot before rendering connected state.
- Reconcile the visible transcript, permissions, and questions after every reconnect.
- Preserve one prompt `messageID` across retry and app resume.
- Treat heartbeat loss as disconnection and use bounded backoff plus foreground/network recovery.
- Never clear a pending permission solely because the event stream closed.
- Record persistence, event receipt, store application, and render timestamps for diagnostics.

### MCR-9: Protocol and Capability Discovery

Status: pending

Expose the synchronization and idempotency capabilities a client may rely on.

Acceptance criteria:

- Health or capability response identifies server version and supported state-sync protocol.
- Clients can distinguish authoritative state replay from best-effort global fanout.
- Compatibility failures are explicit rather than degraded silently.
- Mobile can pin a tested OpencodeX capability set independently of upstream OpenCode SDK versions.

## Priority

1. MCR-1, MCR-3, MCR-7
2. MCR-5, MCR-6
3. MCR-4, MCR-9
4. MCR-8 after mobile repository selection

MCR-2 is implemented locally and must be included in the cross-process E2E before integration.

## Validation Gate

Do not call multi-client reliability complete until one test run demonstrates TUI-like, GUI-like, and mobile-like clients connected to the same canonical server and passing prompt, transcript, permission, reconnect, and restart scenarios.
