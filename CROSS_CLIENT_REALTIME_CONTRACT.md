# Cross-Client Realtime Contract

Last updated: 2026-08-12

## Repository State

- Base: `ecgreen/OpencodeX` `main` at `5e334fe`.
- PR #10 (hub workspace mirror and per-directory sync history) is merged.
- PR #11 (session prompt delivery controls) is merged.
- PR #13 (restart-safe GUI sidecar) remains open.
- The local branch for this work is `test/cross-client-realtime-contract` in the isolated worktree `/Users/josh/agents/worktrees/cross-client-realtime-contract`.

## Contract Under Test

The OpencodeX GUI and TUI both consume `GET /global/event`. The reported mobile symptom is that a prompt submitted from the CLI does not appear in an already-open mobile session until the session is left and re-entered.

The server-side contract is:

1. A second client can open `/global/event` and receive `server.connected` as a readiness frame.
2. Another client can submit a user prompt through `POST /session/:sessionID/message`.
3. The existing global-event subscriber receives the correlated `message.part.updated` event containing the prompt text without fetching the transcript.
4. The same text is immediately present in the persisted session message list.

The test uses `noReply: true`. This exercises the same user-prompt acceptance and persistence path used by CLI clients without introducing model/provider timing into the realtime delivery contract.

## Result

The server contract passes on current ecgreen `main`.

This narrows the observed stale mobile session toward the client or transport path, including:

- a dropped or suspended SSE connection;
- missed-event recovery after reconnect;
- mobile store event filtering or reconciliation;
- rendering or focus lifecycle behavior.

It does not prove that every deployed server/network path has low latency, so mobile instrumentation should still record persistence, publication, receipt, store application, and render times.

## Verification

- `bun test test/server/httpapi-event.test.ts`: 4 passed.
- Event/global/session/compression regression set: 30 passed.
- `packages/opencode` typecheck: clean.
- `git diff --check`: clean.

## Upstream Strategy Finding

OpencodeX has a documented upstream policy in `docs/UPSTREAM.md`, `upstream/lock.json`, and `upstream/policy.json`:

- A monthly workflow detects new upstream OpenCode releases without merging them automatically.
- A manual sync report and merge-tree rehearsal measure API, storage, provider, dependency, frontend, and shared-seam changes.
- Actual updates use a dedicated `chore/upstream-vX.Y.Z` branch and draft PR.
- Upstream-owned backend changes are accepted where compatible, fork-owned paths are preserved, and shared seams receive manual review.
- The upstream lock advances only after migration, SDK, package, CLI, GUI, and surface-policy gates pass and the sync PR merges.

The policy also states that the first formal upstream sync has not run yet. Mobile integrations should therefore prefer upstream SDK/contracts, negotiate OpencodeX-specific capabilities explicitly, and pin tested OpencodeX compatibility until that process has demonstrated its cadence in practice.

## 2026-08-12 Streaming Incident

The reported duplicate prompts, dropped output, and permission-stream aborts exposed two independent failure domains on the development machine.

### Split Live Event Buses

Two OpencodeX servers were listening on port 4096 at the same time:

- The TUI coordinator listened on `127.0.0.1:4096`.
- The launchd hub listened on `0.0.0.0:4096` for LAN and Tailscale clients.

Both processes opened the same SQLite database, but `/global/event` fanout is process-local. Loopback clients therefore received coordinator events while mobile clients received hub events. Persisted messages became visible to either process on transcript refetch, which explains why session re-entry could reveal messages that never arrived live.

No `workspace` rows existed, and the affected session had no `workspace_id`, so the hub adapter was not bridging these process-local buses. The installed servers emitted 10-second heartbeats; no server-side SSE idle timeout was found.

Operational remediation must make one process authoritative or explicitly configure and attach the hub workspace. Do not point a local hub adapter at `127.0.0.1:4096` while the coordinator owns that address; use the LAN or Tailscale address so it reaches the launchd hub.

### Durable Command Replay

The affected Claude session contained one persisted user row for each reported prompt, not three. The "design doc" command had `claim_generation = 3`, showing that the same durable command was reclaimed multiple times rather than submitted as three separate messages.

The command recovery loop previously waited behind a valid foreign command lease. If that owner's heartbeat later lapsed, the waiting recovery fiber reclaimed and resent the command to the external Claude driver. The fix on this branch:

- treats an actively foreign-owned command as occupied and exits that recovery attempt;
- starts the command heartbeat immediately after claim, including while waiting for the session execution turn;
- wakes queued and expired predecessor commands together when a new prompt arrives;
- still permits an explicit later recovery pass to reclaim a command after its lease expires.

Permission requests and message events share the event stream, but permission requests themselves are durable in `session_interaction` and recoverable through authoritative state or `GET /permission`. `AbortError: Stream closed` identifies a client, sidecar, or external-driver transport interruption; it is not evidence that the permission row was lost.
