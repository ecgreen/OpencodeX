import { EventV2Bridge } from "@/event-v2-bridge"
import { Identifier } from "@/id/id"
import { SessionID } from "@/session/schema"
import { EventV2 } from "@opencode-ai/core/event"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Clock, Context, Deferred, Duration, Effect, Layer, Schema, SynchronizedRef } from "effect"
import {
  capabilitiesFor,
  type Lease,
  type Pending,
  prune,
  removeClientFromScopes,
  scopeKey,
  selectRegistration,
  type State,
  supports,
  syncScopeIndex,
} from "./gui-bridge-state"

const DEFAULT_TIMEOUT = Duration.seconds(30)
export const MAX_SCOPES = 512
export const MAX_PNG_BYTES = 5 * 1024 * 1024
export const MAX_SNAPSHOT_LENGTH = 200_000
const PNG_DATA_URL_PREFIX = "data:image/png;base64,"
const MAX_PNG_DATA_URL_LENGTH = PNG_DATA_URL_PREFIX.length + Math.ceil(MAX_PNG_BYTES / 3) * 4

export const ClientID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).pipe(
  Schema.brand("GuiBridge.ClientID"),
)
export type ClientID = typeof ClientID.Type

export const Token = Schema.String.check(Schema.isMinLength(32), Schema.isMaxLength(512)).pipe(
  Schema.brand("GuiBridge.Token"),
)
export type Token = typeof Token.Type

export const RequestID = Schema.String.check(Schema.isStartsWith("gbr_")).pipe(Schema.brand("GuiBridge.RequestID"))
export type RequestID = typeof RequestID.Type

export const LeaseGeneration = Schema.String.check(Schema.isStartsWith("gbl_")).pipe(
  Schema.brand("GuiBridge.LeaseGeneration"),
)
export type LeaseGeneration = typeof LeaseGeneration.Type

export const Operation = Schema.Literals([
  "workspace.open",
  "browser.navigate",
  "browser.state",
  "browser.screenshot",
  "browser.snapshot",
])
export type Operation = typeof Operation.Type

export const WorkspaceOpenInput = Schema.Struct({ path: Schema.String })
export const BrowserNavigateInput = Schema.Struct({ url: Schema.String })
export const BrowserStateInput = Schema.Struct({})
export const BrowserCaptureInput = Schema.Struct({ expectedURL: Schema.String })

export const WorkspaceOpenOutput = Schema.Struct({ path: Schema.String })
export const BrowserNavigateOutput = Schema.Struct({ url: Schema.String })
export const BrowserStateOutput = Schema.Struct({ url: Schema.String })
export const BrowserScreenshotOutput = Schema.Struct({
  url: Schema.String,
  dataURL: Schema.String.check(
    Schema.isPattern(/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/),
    Schema.isMaxLength(MAX_PNG_DATA_URL_LENGTH),
  ),
})
export const BrowserSnapshotOutput = Schema.Struct({
  url: Schema.String,
  text: Schema.String.check(Schema.isMaxLength(MAX_SNAPSHOT_LENGTH)),
})

export const RequestInput = Schema.Union([
  WorkspaceOpenInput,
  BrowserNavigateInput,
  BrowserStateInput,
  BrowserCaptureInput,
])
export type RequestInput = typeof RequestInput.Type

export const ResponseOutput = Schema.Union([
  WorkspaceOpenOutput,
  BrowserNavigateOutput,
  BrowserStateOutput,
  BrowserScreenshotOutput,
  BrowserSnapshotOutput,
])
export type ResponseOutput = typeof ResponseOutput.Type

export const OperationRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("workspace.open"), input: WorkspaceOpenInput }),
  Schema.Struct({ operation: Schema.Literal("browser.navigate"), input: BrowserNavigateInput }),
  Schema.Struct({ operation: Schema.Literal("browser.state"), input: BrowserStateInput }),
  Schema.Struct({ operation: Schema.Literal("browser.screenshot"), input: BrowserCaptureInput }),
  Schema.Struct({ operation: Schema.Literal("browser.snapshot"), input: BrowserCaptureInput }),
])
export type OperationRequest = typeof OperationRequest.Type

export const RegistrationScope = Schema.Struct({
  directory: Schema.String.check(Schema.isMinLength(1)),
  workspaceID: Schema.optional(WorkspaceV2.ID),
})
export type Scope = typeof RegistrationScope.Type

const RegistrationScopes = Schema.UniqueArray(RegistrationScope).check(Schema.isMaxLength(MAX_SCOPES))
const Capabilities = Schema.UniqueArray(Operation).check(Schema.isMaxLength(Operation.literals.length))

export class Registration extends Schema.Class<Registration>("GuiBridgeRegistration")({
  clientID: ClientID,
  token: Token,
  capabilities: Capabilities,
  scopes: RegistrationScopes,
  expiresAt: Schema.optional(Schema.Number),
}) {}

export const SyncPayload = Schema.Struct({
  clientID: ClientID,
  token: Token,
  capabilities: Capabilities,
  scopes: RegistrationScopes,
})
export const SyncResult = Schema.Struct({
  ok: Schema.Literal(true),
  generation: LeaseGeneration,
  added: Schema.Int,
  removed: Schema.Int,
  unchanged: Schema.Int,
})
export const UnregisterPayload = Schema.Struct({
  clientID: ClientID,
  token: Token,
  generation: LeaseGeneration,
})
export const MutationResult = Schema.Struct({ ok: Schema.Literal(true) })

const FailureResult = Schema.Struct({
  status: Schema.Literal("error"),
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(10_000)),
})
const responseFields = {
  clientID: ClientID,
  token: Token,
  requestID: RequestID,
}

export const RespondPayload = Schema.Union([
  Schema.Struct({
    ...responseFields,
    operation: Schema.Literal("workspace.open"),
    result: Schema.Union([Schema.Struct({ status: Schema.Literal("ok"), output: WorkspaceOpenOutput }), FailureResult]),
  }),
  Schema.Struct({
    ...responseFields,
    operation: Schema.Literal("browser.navigate"),
    result: Schema.Union([
      Schema.Struct({ status: Schema.Literal("ok"), output: BrowserNavigateOutput }),
      FailureResult,
    ]),
  }),
  Schema.Struct({
    ...responseFields,
    operation: Schema.Literal("browser.state"),
    result: Schema.Union([Schema.Struct({ status: Schema.Literal("ok"), output: BrowserStateOutput }), FailureResult]),
  }),
  Schema.Struct({
    ...responseFields,
    operation: Schema.Literal("browser.screenshot"),
    result: Schema.Union([
      Schema.Struct({ status: Schema.Literal("ok"), output: BrowserScreenshotOutput }),
      FailureResult,
    ]),
  }),
  Schema.Struct({
    ...responseFields,
    operation: Schema.Literal("browser.snapshot"),
    result: Schema.Union([
      Schema.Struct({ status: Schema.Literal("ok"), output: BrowserSnapshotOutput }),
      FailureResult,
    ]),
  }),
])
export type RespondPayload = typeof RespondPayload.Type

export const Event = {
  Request: EventV2.define({
    type: "opencodex.gui_bridge.request",
    schema: {
      requestID: RequestID,
      clientID: ClientID,
      sessionID: SessionID,
      operation: Operation,
      input: RequestInput,
    },
  }),
}

export class AuthenticationError extends Schema.TaggedErrorClass<AuthenticationError>()(
  "GuiBridgeAuthenticationError",
  { clientID: ClientID },
) {
  override get message() {
    return `GUI bridge authentication failed for client ${this.clientID}.`
  }
}

export class RequestNotFoundError extends Schema.TaggedErrorClass<RequestNotFoundError>()(
  "GuiBridgeRequestNotFoundError",
  { requestID: RequestID },
) {
  override get message() {
    return `GUI bridge request ${this.requestID} is no longer pending.`
  }
}

export class CorrelationError extends Schema.TaggedErrorClass<CorrelationError>()("GuiBridgeCorrelationError", {
  requestID: RequestID,
  expected: Operation,
  received: Operation,
}) {
  override get message() {
    return `GUI bridge response operation ${this.received} does not match ${this.expected}.`
  }
}

export class UnavailableError extends Schema.TaggedErrorClass<UnavailableError>()("GuiBridgeUnavailableError", {
  operation: Operation,
}) {
  override get message() {
    return `No live GUI bridge supports ${this.operation} for this workspace.`
  }
}

export class TimeoutError extends Schema.TaggedErrorClass<TimeoutError>()("GuiBridgeTimeoutError", {
  requestID: RequestID,
  operation: Operation,
}) {
  override get message() {
    return `GUI bridge request ${this.requestID} timed out while waiting for ${this.operation}.`
  }
}

export class RemoteError extends Schema.TaggedErrorClass<RemoteError>()("GuiBridgeRemoteError", {
  operation: Operation,
  message: Schema.String,
}) {}

export class InvalidResponseError extends Schema.TaggedErrorClass<InvalidResponseError>()(
  "GuiBridgeInvalidResponseError",
  { operation: Operation, detail: Schema.String },
) {
  override get message() {
    return `The GUI returned an invalid ${this.operation} response: ${this.detail}`
  }
}

export type Request = Scope &
  OperationRequest & {
    readonly sessionID: SessionID
    readonly timeout?: Duration.Input
  }

export type Error = UnavailableError | TimeoutError | RemoteError
export type ResponseError = AuthenticationError | RequestNotFoundError | CorrelationError

export interface Interface {
  readonly sync: (input: Registration) => Effect.Effect<typeof SyncResult.Type, AuthenticationError>
  readonly unregister: (input: typeof UnregisterPayload.Type) => Effect.Effect<void, AuthenticationError>
  readonly capabilities: (input: Scope) => Effect.Effect<Operation[]>
  readonly request: (input: Request) => Effect.Effect<ResponseOutput, Error>
  readonly respond: (input: RespondPayload) => Effect.Effect<void, ResponseError>
}

type SyncStateResult =
  | { readonly _tag: "Unauthorized"; readonly invalidated: Pending[] }
  | {
      readonly _tag: "Synced"
      readonly invalidated: Pending[]
      readonly redeliver: Pending[]
      readonly result: typeof SyncResult.Type
    }
type UnregisterStateResult =
  | { readonly _tag: "Unauthorized"; readonly invalidated: Pending[] }
  | { readonly _tag: "Unregistered"; readonly invalidated: Pending[] }
type RespondStateResult =
  | { readonly _tag: "Missing"; readonly invalidated: Pending[] }
  | { readonly _tag: "Unauthorized"; readonly invalidated: Pending[]; readonly pending: Pending }
  | { readonly _tag: "Mismatched"; readonly invalidated: Pending[]; readonly pending: Pending }
  | { readonly _tag: "Matched"; readonly invalidated: Pending[]; readonly pending: Pending }

export class Service extends Context.Service<Service, Interface>()("@opencode/GuiBridge") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const state = yield* SynchronizedRef.make<State>({ registrations: new Map(), scopes: new Map(), pending: new Map() })

    const failPending = (pending: Pending[]) =>
      Effect.forEach(
        pending,
        (item) => Deferred.fail(item.deferred, new UnavailableError({ operation: item.operation })),
        { discard: true },
      )

    const publishRequest = (pending: Pending) =>
      events.publish(
        Event.Request,
        {
          requestID: pending.requestID,
          clientID: pending.clientID,
          sessionID: pending.sessionID,
          operation: pending.operation,
          input: pending.input,
        },
        { location: { directory: AbsolutePath.make(pending.scope.directory), workspaceID: pending.scope.workspaceID } },
      )

    yield* Effect.addFinalizer(() =>
      SynchronizedRef.modify(state, (current) => [
        Array.from(current.pending.values()),
        { registrations: new Map(), scopes: new Map(), pending: new Map() },
      ]).pipe(Effect.flatMap(failPending)),
    )

    const sync: Interface["sync"] = Effect.fn("GuiBridge.sync")(function* (input) {
      const now = yield* Clock.currentTimeMillis
      const result = yield* SynchronizedRef.modify(state, (current): readonly [SyncStateResult, State] => {
        const pruned = prune(current, now)
        const existing = pruned.state.registrations.get(input.clientID)
        if (existing && existing.token !== input.token) {
          return [{ _tag: "Unauthorized", invalidated: pruned.invalidated }, pruned.state]
        }

        const desired = new Map(input.scopes.map((scope) => [scopeKey(scope), scope]))
        const previous = existing?.scopes ?? new Map<string, Scope>()
        const added = Array.from(desired.keys()).filter((key) => !previous.has(key))
        const removed = Array.from(previous.keys()).filter((key) => !desired.has(key))
        const unchanged = Array.from(desired.keys()).filter((key) => previous.has(key))
        const generation = LeaseGeneration.make(Identifier.create("gbl", "ascending"))
        const registration: Lease = { ...input, generation, scopes: desired }
        const registrations = new Map(pruned.state.registrations)
        registrations.delete(input.clientID)
        if (desired.size > 0) registrations.set(input.clientID, registration)
        const scopes = syncScopeIndex(pruned.state.scopes, input.clientID, previous, desired)
        const affected = Array.from(pruned.state.pending.values()).filter(
          (item) => item.clientID === input.clientID && !supports(registration, item.scope, item.operation),
        )
        const pending = new Map(pruned.state.pending)
        affected.forEach((item) => pending.delete(item.requestID))
        return [
          {
            _tag: "Synced",
            invalidated: [...pruned.invalidated, ...affected],
            redeliver: Array.from(pending.values()).filter(
              (item) => item.clientID === input.clientID && supports(registration, item.scope, item.operation),
            ),
            result: { ok: true, generation, added: added.length, removed: removed.length, unchanged: unchanged.length },
          },
          { registrations, scopes, pending },
        ]
      })
      yield* failPending(result.invalidated)
      if (result._tag === "Unauthorized") return yield* new AuthenticationError({ clientID: input.clientID })
      yield* Effect.forEach(result.redeliver, publishRequest, { discard: true })
      return result.result
    }, Effect.uninterruptible)

    const unregister: Interface["unregister"] = Effect.fn("GuiBridge.unregister")(function* (input) {
      const now = yield* Clock.currentTimeMillis
      const result = yield* SynchronizedRef.modify(state, (current): readonly [UnregisterStateResult, State] => {
        const pruned = prune(current, now)
        const registration = pruned.state.registrations.get(input.clientID)
        if (!registration) {
          return [{ _tag: "Unregistered", invalidated: pruned.invalidated }, pruned.state]
        }
        if (registration.token !== input.token) {
          return [{ _tag: "Unauthorized", invalidated: pruned.invalidated }, pruned.state]
        }
        if (registration.generation !== input.generation) {
          return [{ _tag: "Unregistered", invalidated: pruned.invalidated }, pruned.state]
        }
        const registrations = new Map(pruned.state.registrations)
        registrations.delete(input.clientID)
        const affected = Array.from(pruned.state.pending.values()).filter((item) => item.clientID === input.clientID)
        const pending = new Map(pruned.state.pending)
        affected.forEach((item) => pending.delete(item.requestID))
        return [
          { _tag: "Unregistered", invalidated: [...pruned.invalidated, ...affected] },
          {
            registrations,
            scopes: removeClientFromScopes(pruned.state.scopes, input.clientID),
            pending,
          },
        ]
      })
      yield* failPending(result.invalidated)
      if (result._tag === "Unauthorized") return yield* new AuthenticationError({ clientID: input.clientID })
    }, Effect.uninterruptible)

    const capabilities: Interface["capabilities"] = Effect.fn("GuiBridge.capabilities")(function* (input) {
      const now = yield* Clock.currentTimeMillis
      const result = yield* SynchronizedRef.modify(state, (current) => {
        const pruned = prune(current, now)
        return [{ value: capabilitiesFor(pruned.state, input), invalidated: pruned.invalidated }, pruned.state]
      })
      yield* failPending(result.invalidated)
      return result.value
    }, Effect.uninterruptible)

    const request: Interface["request"] = Effect.fn("GuiBridge.request")(function* (input) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const requestID = RequestID.make(Identifier.create("gbr", "ascending"))
          const deferred = yield* Deferred.make<ResponseOutput, RemoteError | UnavailableError>()
          const selected = yield* SynchronizedRef.modify(state, (current) => {
            const pruned = prune(current, now)
            const registration = selectRegistration(pruned.state, input, input.operation)
            if (!registration) return [{ registration, invalidated: pruned.invalidated }, pruned.state]
            const pending = new Map(pruned.state.pending).set(requestID, {
              requestID,
              clientID: registration.clientID,
              token: registration.token,
              scope: { directory: input.directory, workspaceID: input.workspaceID },
              operation: input.operation,
              sessionID: input.sessionID,
              input: input.input,
              deferred,
            })
            return [{ registration, invalidated: pruned.invalidated }, { ...pruned.state, pending }]
          })
          yield* failPending(selected.invalidated)
          if (!selected.registration) return yield* new UnavailableError({ operation: input.operation })

          return yield* restore(
            Effect.gen(function* () {
              yield* publishRequest({
                requestID,
                clientID: selected.registration.clientID,
                token: selected.registration.token,
                scope: { directory: input.directory, workspaceID: input.workspaceID },
                operation: input.operation,
                sessionID: input.sessionID,
                input: input.input,
                deferred,
              })
              return yield* Deferred.await(deferred).pipe(
                Effect.timeoutOrElse({
                  duration: input.timeout ?? DEFAULT_TIMEOUT,
                  orElse: () => Effect.fail(new TimeoutError({ requestID, operation: input.operation })),
                }),
              )
            }),
          ).pipe(
            Effect.ensuring(
              SynchronizedRef.update(state, (current) => {
                if (current.pending.get(requestID)?.deferred !== deferred) return current
                const pending = new Map(current.pending)
                pending.delete(requestID)
                return { ...current, pending }
              }),
            ),
          )
        }),
      )
    })

    const respond: Interface["respond"] = Effect.fn("GuiBridge.respond")(function* (input) {
      const now = yield* Clock.currentTimeMillis
      const result = yield* SynchronizedRef.modify(state, (current): readonly [RespondStateResult, State] => {
        const pruned = prune(current, now)
        const pending = pruned.state.pending.get(input.requestID)
        if (!pending) return [{ _tag: "Missing", invalidated: pruned.invalidated }, pruned.state]
        const registration = pruned.state.registrations.get(input.clientID)
        if (
          !registration ||
          registration.token !== input.token ||
          pending.token !== input.token ||
          pending.clientID !== input.clientID ||
          !supports(registration, pending.scope, pending.operation)
        ) {
          return [{ _tag: "Unauthorized", invalidated: pruned.invalidated, pending }, pruned.state]
        }
        if (pending.operation !== input.operation) {
          return [{ _tag: "Mismatched", invalidated: pruned.invalidated, pending }, pruned.state]
        }
        const entries = new Map(pruned.state.pending)
        entries.delete(input.requestID)
        return [
          { _tag: "Matched", invalidated: pruned.invalidated, pending },
          { ...pruned.state, pending: entries },
        ]
      })
      yield* failPending(result.invalidated)
      if (result._tag === "Missing") return yield* new RequestNotFoundError({ requestID: input.requestID })
      if (result._tag === "Unauthorized") return yield* new AuthenticationError({ clientID: input.clientID })
      if (result._tag === "Mismatched") {
        return yield* new CorrelationError({
          requestID: input.requestID,
          expected: result.pending.operation,
          received: input.operation,
        })
      }
      if (input.result.status === "error") {
        yield* Deferred.fail(
          result.pending.deferred,
          new RemoteError({ operation: input.operation, message: input.result.message }),
        )
        return
      }
      yield* Deferred.succeed(result.pending.deferred, input.result.output)
    }, Effect.uninterruptible)

    return Service.of({ sync, unregister, capabilities, request, respond })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer))

export * as GuiBridge from "./gui-bridge"
