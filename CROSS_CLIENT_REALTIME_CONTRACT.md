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

OpencodeX currently retains upstream-compatible OpenCode HTTP contracts where practical, while adding fork-specific capabilities. The mobile client should prefer upstream SDK/contracts and negotiate OpencodeX-specific behavior explicitly. The repository's longer-term merge/rebase cadence with upstream OpenCode is not documented clearly enough to assume automatic compatibility; this remains a maintainer decision to clarify with ecgreen.
