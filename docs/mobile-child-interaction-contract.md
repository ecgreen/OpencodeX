# Mobile Child Interaction Contract

Status: implementation contract for a prospective mobile client. It separates
existing server/SDK behavior from requirements the mobile integration must
implement and test. It does not add a mobile endpoint.

## Scope And Identity

The mobile client is a client of the existing OpencodeX server. It must use the
generated v2 SDK types and routes, not infer state from titles or display
ordering.

- `sessionID` is the primary identity for a conversation. A title, slug,
  directory, or parent is not a substitute for it.
- Every v2 state-sync request and durable stream is scoped by `directory` and,
  when the deployment uses workspaces, `workspace`. The v2 transport passes
  both to state snapshot, session-card, session-detail, event, and capability APIs
  ([client-sync-transport.ts](../packages/sdk/js/src/v2/client-sync-transport.ts#L4-L60)).
- The server accepts `directory` and `workspace` query parameters on workspace
  routes. For ordinary local routing, a session's stored directory wins;
  otherwise the directory query, `x-opencode-directory`, or process directory
  is used ([workspace-routing.ts](../packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts#L21-L26),
  [workspace-routing.ts](../packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts#L66-L73),
  [workspace-routing.ts](../packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts#L145-L166)).
- A mobile cache key must therefore include the effective scope and
  `sessionID`. Never merge same-named sessions from different directories or
  workspaces.

One backend coordinator is authoritative for each SQLite database. Mobile
attaches to that authority over its supported HTTP/SSE surface; it must never
open, recover, or start a competing writer for the same database. Active-active
writers are out of scope, and generic standalone servers do not yet enforce the
coordinator invariant below GUI/TUI launch paths
([BACKEND_SYNC_PROGRESS.md](../BACKEND_SYNC_PROGRESS.md#goal),
[BACKEND_SYNC_PROGRESS.md](../BACKEND_SYNC_PROGRESS.md#recommended-resume-order)).

The server-authoritative v2 root snapshot contains `scope`, `epoch`, `cursor`,
`digest`, catalog/operations revisions, and catalog payloads
([types.gen.ts](../packages/sdk/js/src/v2/gen/types.gen.ts#L2635-L2658)). A
session snapshot additionally contains the scoped session record and paged
messages ([types.gen.ts](../packages/sdk/js/src/v2/gen/types.gen.ts#L2717-L2724)).
Treat those values as opaque protocol fields except for the reconciliation rules
below.

## Parent And Child Discovery

Child discovery is explicit and must not depend on a transcript tool part being
loaded.

1. Load the parent session record. Its `parentID`, when present, identifies its
   parent; the v2 selector defines children as all known sessions whose
   `parentID` equals the requested session ID
   ([client-sync-state.ts](../packages/sdk/js/src/v2/client-sync-state.ts#L388-L390)).
2. For authoritative server discovery, call `GET /session/{sessionID}/children`
   (`client.session.children({ sessionID, directory, workspace })`). The route
   returns `Session.Info[]` and is documented as the children forked from that
   parent ([groups/session.ts](../packages/opencode/src/server/routes/instance/httpapi/groups/session.ts#L80-L90),
   [groups/session.ts](../packages/opencode/src/server/routes/instance/httpapi/groups/session.ts#L145-L155),
   [sdk.gen.ts](../packages/sdk/js/src/v2/gen/sdk.gen.ts#L6159-L6188)).
3. A child can be discovered from the root catalog when it is present there, or
   from the explicit children endpoint when it is not. Keep the same
   `sessionID` record and do not create a second local identity.

`GET /session?roots=true` intentionally excludes records with a `parentID`; it
is a root catalog, not proof that no children exist
([session.ts](../packages/opencode/src/session/session.ts#L744-L755)). Mobile
must retain the parent identity needed to request its children explicitly.

The mobile UI may group children below a parent and may open a child transcript.
The contract does not promise a server-pushed child-only hierarchy event; use
the catalog/session events and refresh the parent/children list when a session
is created, updated, or deleted.

## Authoritative State And Events

Prefer the v2 state controller (`createClientStateSync`) and its transport:

- `opencodex.state.snapshot` for the atomic root snapshot.
- `opencodex.state.sessionCards` for catalog pages.
- `opencodex.state.session` for a session tail or an older page (`before` cursor).
- `opencodex.state.event` for the resumable state stream, starting after the
  last accepted cursor.
- `opencodex.state.capabilities` when capabilities are needed.

These are the SDK transport operations, including their scope and abort-signal
behavior ([client-sync-transport.ts](../packages/sdk/js/src/v2/client-sync-transport.ts#L4-L60)).
The catalog snapshot exposes session status, pending permissions, pending
questions, and session UI state as separate fields
([client-sync-types.ts](../packages/sdk/js/src/v2/client-sync-types.ts#L109-L118)).

There are two distinct event inputs:

- The durable `opencodex.state.event` stream carries invalidation envelopes,
  not message deltas. Each event identifies a domain, aggregate, sequence, and
  `payload.eventType`; the sync controller uses it to invalidate and reload
  catalog, operations, capabilities, or session state
  ([client-sync-transport.ts](../packages/sdk/js/src/v2/client-sync-transport.ts#L133-L151),
  [client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L772-L820)).
- Raw typed live events are a separate low-latency input. Feed them to
  `controller.applyEvent`/`applyEvents`; never decode a durable invalidation as
  though it were a raw event
  ([client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L1007-L1029)).

The raw `/global/event` stream is not request-scoped. Its outer envelope carries
`directory`, optional `project`, and optional `workspace`; compare those fields
to the controller's effective scope **before** extracting `payload` and calling
`applyEvent`. Discard cross-scope envelopes so interactions and transcript
parts cannot leak between directories or workspaces
([global.ts](../packages/opencode/src/server/routes/instance/httpapi/groups/global.ts#L34-L48)).

Relevant raw live events include:

- `session.status` with `{ sessionID, status }`; status is `idle`, `busy`, or
  `retry` with its retry fields ([status.ts](../packages/opencode/src/session/status.ts#L13-L40)).
- `message.updated`, `message.part.updated`, `message.part.delta`, and their
  removal events. A part delta is scoped by `sessionID`, `messageID`, `partID`,
  `field`, and `delta` ([message-v2.ts](../packages/opencode/src/session/message-v2.ts#L57-L72)).
- `session.deleted`, which removes the session and invalidates its detail cache.
- `permission.asked` / `permission.replied` and `question.asked` /
  `question.replied` / `question.rejected`.

The shared parity test is the behavioral reference for projecting the same
sessions, statuses, interactions, and transcript in GUI and TUI, including
duplicate deltas, out-of-order parts, and interaction resolution
([state-contract.parity.test.ts](../packages/gui/test/state-contract.parity.test.ts#L32-L89),
[state-contract.parity.test.ts](../packages/gui/test/state-contract.parity.test.ts#L156-L229)).

## Permissions And Questions

Filter pending interactions by `request.sessionID === activeSessionID` before
rendering an active-session card. A request ID is globally the reply identity;
do not use a tool call ID, message ID, or array index. The root catalog has
separate permission and question collections, so a client must not display an
interaction from another session in the current session's composer.

Permission payloads contain `id`, `sessionID`, `permission`, `patterns`,
`metadata`, `always`, and optional tool `{ messageID, callID }`
([permission/index.ts](../packages/opencode/src/permission/index.ts#L36-L50)).
Reply through `POST /permission/{requestID}/reply` with `reply: "once"`,
`"always"`, or `"reject"`, plus optional feedback `message`; use the scoped
directory/workspace query. The mobile route is the generated
`client.permission.reply` method and the server's reply schema is the
authoritative shape ([session-api.ts](../packages/gui/src/renderer/src/lib/session-api.ts#L313-L329),
[sdk.gen.ts](../packages/sdk/js/src/v2/gen/sdk.gen.ts#L5656-L5694)).

Question payloads contain `id`, `sessionID`, ordered `questions`, and optional
tool identity. Each question has `header`, complete `question` text, options,
and optional `multiple`/`custom` flags
([question/index.ts](../packages/opencode/src/question/index.ts#L19-L69)). Reply
with answers in question order through `client.question.reply`; reject through
`client.question.reject`. Do not submit a partial answer array or assume every
question is single-select ([question/index.ts](../packages/opencode/src/question/index.ts#L71-L79),
[session-api.ts](../packages/gui/src/renderer/src/lib/session-api.ts#L331-L349)).

After a successful reply/reject, remove the matching pending card only when the
corresponding `permission.replied`, `question.replied`, or `question.rejected`
event is applied, or when a reconciled snapshot no longer contains it. The
parity test requires both collections to be empty after their resolution events
([state-contract.parity.test.ts](../packages/gui/test/state-contract.parity.test.ts#L214-L228)).

## Prompt, Reply, And Stop

Use the existing session routes:

- `POST /session/{sessionID}/prompt_async` for an accepted prompt that returns
  immediately.
- `POST /session/{sessionID}/command` for a slash/server command.
- `POST /session/{sessionID}/shell` for a shell command.
- `POST /session/{sessionID}/abort` to stop the active session.

The route declarations and payloads are in
[groups/session.ts](../packages/opencode/src/server/routes/instance/httpapi/groups/session.ts#L72-L105)
and the server abort handler calls prompt cancellation and returns `true`
([handlers/session.ts](../packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts#L275-L278)).
The generated GUI adapter supplies a unique `messageID` for prompt, command,
and shell submissions ([session-api.ts](../packages/gui/src/renderer/src/lib/session-api.ts#L184-L209),
[session-api.ts](../packages/gui/src/renderer/src/lib/session-api.ts#L268-L285)).
For durable `prompt_async`, mobile should generate one stable message ID per
logical submission and reuse it only when retrying that same accepted prompt.
Command and shell routes may perform side effects before their outcome reaches
the client; after an ambiguous response, retain their ID for correlation but do
not replay them automatically.

The visible mobile **Stop** action is the semantic equivalent of the confirmed
second TUI Escape: it calls
`client.session.abort({ sessionID, directory, workspace })` for the targeted
session. It does not need a second tap. If mobile also exposes a raw Escape-key
binding, that binding should preserve the TUI confirmation behavior:

1. The first Escape within the interaction surface arms the interrupt window
   and clears transient UI state.
2. A second Escape for the same active session within five seconds calls
   `client.session.abort({ sessionID, directory, workspace })`.
3. The window resets after five seconds, immediately after dispatching abort,
   or when the active session changes.

The TUI implementation increments an interrupt counter, clears on the first
press, and aborts on the second ([commands.tsx](../packages/opencode/src/cli/cmd/tui/component/prompt/commands.tsx#L158-L187)).
The abort target identity must come from the active route, not an unrelated
selected session. Server cancellation also cancels background jobs associated
with that session; it does not imply cancellation of unrelated sessions
([run-state.ts](../packages/opencode/src/session/run-state.ts#L298-L300)).
An abort can leave an `MessageAbortedError` in the stored assistant message;
that is data to reconcile, not a reason to resurrect the turn.

Session abort is not automatically whole-swarm cancellation. The TUI separately
calls the experimental swarm cancel route when the active session carries an
active `swarmID`
([commands.tsx](../packages/opencode/src/cli/cmd/tui/component/prompt/commands.tsx#L158-L186)).
Mobile must not advertise “Stop swarm” unless it implements that explicit route
and reconciles the resulting swarm state.

## Transcript Visibility

Session snapshots are raw history. The mobile transcript projection must match
the established visibility policy:

- Hide structural `step-start`, `step-finish`, and `snapshot` parts, compaction
  parts, blank text, ignored text, and text parts marked `synthetic`.
- Keep non-empty reasoning and tool parts.
- Keep a real failure visible. An abort-only message with no visible parts is
  omitted, but an aborted message that contains visible work remains visible.
- If an aborted assistant turn is immediately followed by a synthetic steering
  turn, keep the interrupted work but suppress that interruption error.

These rules are implemented by `visibleTranscriptMessages` and
`visibleTranscriptParts` ([transcript-visibility.ts](../packages/gui/src/renderer/src/lib/transcript-visibility.ts#L59-L113))
and covered by deterministic tests for compaction, blank, synthetic, ignored,
and both steered and ordinary interrupted turns
([transcript.test.ts](../packages/gui/test/transcript.test.ts#L51-L106)).
Synthetic content is therefore retained in the server transcript but is not
automatically user-visible. Do not label hidden synthetic content as a missing
message, and do not show synthetic steering in prompt history.

## Reconnect, Reset, And Reconciliation

The event stream begins with a `ready` frame containing `scope`, `epoch`, and
`cursor`. Persist the last accepted cursor only for the same scope and epoch.
On a dropped stream, reconnect with `after: cursor` and mark existing data
`stale` while retaining it for display. The controller uses bounded exponential
backoff with jitter ([client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L835-L959)).

On `reset_required`, a heartbeat epoch mismatch, or a post-bootstrap queued-frame
overflow:

1. Stop applying queued frames from the old connection generation.
2. Fetch a fresh root snapshot, then capabilities/operations as needed.
3. Refresh retained session tails and drain only frames from the new generation.
4. Replace canonical state for the authoritative epoch; do not merge records
   retained across an epoch boundary.

The controller implements these reset and gap decisions
([client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L759-L823),
[client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L960-L996)).
The parity tests cover event-before-snapshot replay, reconnect, cursor
continuity, and retention reset replacement
([state-contract.parity.test.ts](../packages/gui/test/state-contract.parity.test.ts#L255-L354)).

An aggregate-sequence gap is different: preserve current state, abort that
stream, and reconnect from the last accepted cursor so retained durable events
can replay. Do not reset canonical state unless the server returns an explicit
reset boundary or the controller detects one
([client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L808-L814)).

An overflow while the initial snapshot is still bootstrapping also aborts and
reconnects; it does not invoke canonical `resetState`. The post-bootstrap queue
overflow is the overflow path that resets
([client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L860-L883),
[client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L824-L829)).

Coordinator discovery and restart handoff are deployment responsibilities, not
features of `createClientStateSync`. A mobile host integration must resolve the
same database authority again after an origin change, then create/reconfigure
the transport, refresh capabilities and the canonical snapshot, and reconcile
the selected session, child list, interactions, and status before enabling
mutations. Keep unsent drafts locally, but never auto-submit or auto-retry an
interrupted turn: tools may already have produced side effects. Accepted
durable prompt commands may recover to one terminal command status, but this
contract does not promise an uninterrupted stream or exactly-once model
execution.

## Idempotency And Stale Results

Mobile must either use the SDK sync controller or implement the same guards:

- Each in-flight session request has a generation and an abort signal. A result
  is applied only if its key still points to that generation and the session's
  deletion generation is unchanged.
- A newer request supersedes an older request with the same session/kind/cursor
  key. Late results reject as stale and cannot overwrite current state
  ([client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L430-L468),
  [client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L513-L561)).
- A deleted session creates a tombstone/deletion generation; release requests,
  buffers, and timers before removing detail state
  ([client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L644-L664)).
- Duplicate live event IDs are ignored by the shared state reducer; deltas are
  keyed by session/message/part, not by arrival position. The parity test
  asserts one duplicate event metric and the resulting text
  ([state-contract.parity.test.ts](../packages/gui/test/state-contract.parity.test.ts#L49-L87)).

Durable `prompt_async` admission deduplicates by `(sessionID, messageID)`, so a
retry after response loss must reuse that message ID. For every other mutation,
show an unknown/pending result when the response is ambiguous and reconcile
from the next authoritative event or snapshot. Do not automatically replay
command, shell, reply, reject, abort, or other potentially side-effecting
requests unless that route separately documents idempotency.

## Deterministic Acceptance Cases

The mobile implementation is ready only when these cases pass with fake
transport fixtures and no timing-dependent sleeps:

| Case                  | Required assertion                                                                                                                                                                                                                     | Existing evidence                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scoped identity       | Sessions from two directory/workspace scopes never leak into each other's controller/cache; every state request carries its selected scope.                                                                                            | [client-sync-transport.ts](../packages/sdk/js/src/v2/client-sync-transport.ts#L8-L13)                                                                                                      |
| Child discovery       | Parent with two `parentID` children returns exactly those children; mobile merges explicit `/children` results by ID without inventing identities.                                                                                     | [client-sync-state.ts](../packages/sdk/js/src/v2/client-sync-state.ts#L388-L390), [groups/session.ts](../packages/opencode/src/server/routes/instance/httpapi/groups/session.ts#L145-L155) |
| Interaction filtering | Asked permission/question for session A is absent from session B; matching reply event removes only A's card.                                                                                                                          | [client-sync-types.ts](../packages/sdk/js/src/v2/client-sync-types.ts#L109-L118), [state-contract.parity.test.ts](../packages/gui/test/state-contract.parity.test.ts#L182-L228)            |
| Reply routes          | Permission once/always/reject, question ordered answers, and question reject serialize the documented request ID and scope.                                                                                                            | [session-api.ts](../packages/gui/src/renderer/src/lib/session-api.ts#L313-L349)                                                                                                            |
| Stop                  | Mobile Stop targets its selected session and associated server-owned run/background work; a raw Escape binding requires two presses within five seconds; unrelated sessions and swarms remain untouched without explicit swarm cancel. | [commands.tsx](../packages/opencode/src/cli/cmd/tui/component/prompt/commands.tsx#L158-L187), [run-state.ts](../packages/opencode/src/session/run-state.ts#L298-L300)                      |
| Streaming             | Duplicate and out-of-order part events converge to one transcript with the expected text.                                                                                                                                              | [state-contract.parity.test.ts](../packages/gui/test/state-contract.parity.test.ts#L49-L87), [state-contract.parity.test.ts](../packages/gui/test/state-contract.parity.test.ts#L156-L212) |
| Synthetic visibility  | Synthetic-only, blank, compaction, and ignored parts are hidden; abort-only empty messages are omitted while interrupted visible work remains.                                                                                         | [transcript.test.ts](../packages/gui/test/transcript.test.ts#L51-L106)                                                                                                                     |
| Reconnect             | A dropped stream reconnects after the cursor and retains stale data until current; event-before-snapshot is not lost.                                                                                                                  | [state-contract.parity.test.ts](../packages/gui/test/state-contract.parity.test.ts#L255-L292)                                                                                              |
| Reset                 | `reset_required`, heartbeat epoch change, or post-bootstrap queue overflow replaces canonical state; an event gap or initial-bootstrap overflow reconnects without canonical reset.                                                    | [state-contract.parity.test.ts](../packages/gui/test/state-contract.parity.test.ts#L294-L354), [client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L804-L883)  |
| Stale completion      | A superseded or deleted session request cannot mutate state after its late response.                                                                                                                                                   | [client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L459-L462), [client-sync-controller.ts](../packages/sdk/js/src/v2/client-sync-controller.ts#L644-L664)     |

## Non-Goals And Current Limits

- This contract does not add a mobile-specific server route, push channel, or
  database table.
- It does not make mutations generally idempotent; only durable prompt
  admission has the deduplication guarantee described above.
- It does not require mobile to reproduce GUI layout, transcript scrolling, or
  the GUI's view/project presentation.
- It does not promise that session abort cancels a swarm, uninterrupted streams
  across coordinator replacement, exactly-once model execution, or safe
  active-active database writers.
- It does require mobile to preserve the shared server identity, interaction,
  stop, transcript, and synchronization semantics above.
