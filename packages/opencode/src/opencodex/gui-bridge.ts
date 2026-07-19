import { EventV2Bridge } from "@/event-v2-bridge"
import { Identifier } from "@/id/id"
import { SessionID } from "@/session/schema"
import { EventV2 } from "@opencode-ai/core/event"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Context, Deferred, Duration, Effect, Layer, Schema, SynchronizedRef } from "effect"

const DEFAULT_TIMEOUT = Duration.seconds(30)
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

export class Registration extends Schema.Class<Registration>("GuiBridgeRegistration")({
  clientID: ClientID,
  token: Token,
  directory: Schema.String,
  workspaceID: Schema.optional(WorkspaceV2.ID),
  capabilities: Schema.Array(Operation),
  expiresAt: Schema.optional(Schema.Number),
}) {}

export const RegisterPayload = Schema.Struct({
  clientID: ClientID,
  token: Token,
  capabilities: Schema.Array(Operation),
})

export const ClientPayload = Schema.Struct({ clientID: ClientID, token: Token })
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

export class RegistrationNotFoundError extends Schema.TaggedErrorClass<RegistrationNotFoundError>()(
  "GuiBridgeRegistrationNotFoundError",
  { clientID: ClientID },
) {
  override get message() {
    return `GUI bridge client ${this.clientID} is not registered.`
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

export interface Scope {
  readonly directory: string
  readonly workspaceID?: WorkspaceV2.ID
}

export type Request = Scope &
  OperationRequest & {
    readonly sessionID: SessionID
    readonly timeout?: Duration.Input
  }

export type Error = UnavailableError | TimeoutError | RemoteError
export type ResponseError = AuthenticationError | RegistrationNotFoundError | RequestNotFoundError | CorrelationError

export interface Interface {
  readonly register: (input: Registration) => Effect.Effect<void, AuthenticationError>
  readonly unregister: (input: Scope & typeof ClientPayload.Type) => Effect.Effect<void, ResponseError>
  readonly capabilities: (input: Scope) => Effect.Effect<Operation[]>
  readonly request: (input: Request) => Effect.Effect<ResponseOutput, Error>
  readonly respond: (input: RespondPayload) => Effect.Effect<void, ResponseError>
}

interface Pending {
  readonly requestID: RequestID
  readonly clientID: ClientID
  readonly token: Token
  readonly operation: Operation
  readonly deferred: Deferred.Deferred<ResponseOutput, RemoteError | UnavailableError>
}

interface State {
  readonly registrations: Map<ClientID, Registration>
  readonly pending: Map<RequestID, Pending>
}

type RegisterResult =
  | { readonly _tag: "Unauthorized" }
  | { readonly _tag: "Registered"; readonly invalidated: Pending[] }
type UnregisterResult =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Unauthorized" }
  | { readonly _tag: "WrongScope" }
  | { readonly _tag: "Unregistered"; readonly removed: Pending[] }
type RespondResult =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Unauthorized"; readonly pending: Pending }
  | { readonly _tag: "Mismatched"; readonly pending: Pending }
  | { readonly _tag: "Matched"; readonly pending: Pending }

export class Service extends Context.Service<Service, Interface>()("@opencode/GuiBridge") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const state = yield* SynchronizedRef.make<State>({ registrations: new Map(), pending: new Map() })

    const failPending = (pending: Pending[], error: (item: Pending) => UnavailableError) =>
      Effect.forEach(pending, (item) => Deferred.fail(item.deferred, error(item)), { discard: true })

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const pending = yield* SynchronizedRef.modify(state, (current) => [
          Array.from(current.pending.values()),
          { registrations: new Map(), pending: new Map() },
        ])
        yield* failPending(pending, (item) => new UnavailableError({ operation: item.operation }))
      }),
    )

    const register: Interface["register"] = Effect.fn("GuiBridge.register")(function* (input) {
      const result = yield* SynchronizedRef.modify(state, (current): readonly [RegisterResult, State] => {
        const existing = current.registrations.get(input.clientID)
        if (existing && existing.token !== input.token) return [{ _tag: "Unauthorized" as const }, current]

        const invalidated = Array.from(current.pending.values()).filter(
          (item) =>
            item.clientID === input.clientID &&
            (item.token !== input.token ||
              input.directory !== existing?.directory ||
              input.workspaceID !== existing?.workspaceID ||
              !input.capabilities.includes(item.operation)),
        )
        const registrations = new Map(current.registrations)
        registrations.delete(input.clientID)
        registrations.set(input.clientID, input)
        const pending = new Map(current.pending)
        invalidated.forEach((item) => pending.delete(item.requestID))
        return [
          { _tag: "Registered" as const, invalidated },
          { registrations, pending },
        ]
      })
      if (result._tag === "Unauthorized") return yield* new AuthenticationError({ clientID: input.clientID })
      yield* failPending(result.invalidated, (item) => new UnavailableError({ operation: item.operation }))
    }, Effect.uninterruptible)

    const unregister: Interface["unregister"] = Effect.fn("GuiBridge.unregister")(function* (input) {
      const result = yield* SynchronizedRef.modify(state, (current): readonly [UnregisterResult, State] => {
        const registration = current.registrations.get(input.clientID)
        if (!registration) return [{ _tag: "Missing" as const }, current]
        if (registration.token !== input.token) return [{ _tag: "Unauthorized" as const }, current]
        if (registration.directory !== input.directory || registration.workspaceID !== input.workspaceID) {
          return [{ _tag: "WrongScope" as const }, current]
        }
        const registrations = new Map(current.registrations)
        registrations.delete(input.clientID)
        const removed = Array.from(current.pending.values()).filter((item) => item.clientID === input.clientID)
        const pending = new Map(current.pending)
        removed.forEach((item) => pending.delete(item.requestID))
        return [
          { _tag: "Unregistered" as const, removed },
          { registrations, pending },
        ]
      })
      if (result._tag === "Missing") {
        return yield* new RegistrationNotFoundError({ clientID: input.clientID })
      }
      if (result._tag === "Unauthorized" || result._tag === "WrongScope") {
        return yield* new AuthenticationError({ clientID: input.clientID })
      }
      yield* failPending(result.removed, (item) => new UnavailableError({ operation: item.operation }))
    }, Effect.uninterruptible)

    const capabilities: Interface["capabilities"] = Effect.fn("GuiBridge.capabilities")(function* (input) {
      const registrations = (yield* SynchronizedRef.get(state)).registrations
      return Array.from(
        new Set(
          Array.from(registrations.values())
            .filter((registration) => registrationLive(registration) && scopeMatches(registration, input))
            .flatMap((registration) => registration.capabilities),
        ),
      )
    })

    const request: Interface["request"] = Effect.fn("GuiBridge.request")(function* (input) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const requestID = RequestID.make(Identifier.create("gbr", "ascending"))
          const deferred = yield* Deferred.make<ResponseOutput, RemoteError | UnavailableError>()
          const registration = yield* SynchronizedRef.modify(state, (current) => {
            const registration = selectRegistration(current.registrations, input, input.operation)
            if (!registration) return [undefined, current]
            const pending = new Map(current.pending).set(requestID, {
              requestID,
              clientID: registration.clientID,
              token: registration.token,
              operation: input.operation,
              deferred,
            })
            return [registration, { ...current, pending }]
          })
          if (!registration) return yield* new UnavailableError({ operation: input.operation })

          return yield* restore(
            Effect.gen(function* () {
              yield* events.publish(
                Event.Request,
                {
                  requestID,
                  clientID: registration.clientID,
                  sessionID: input.sessionID,
                  operation: input.operation,
                  input: input.input,
                },
                {
                  location: {
                    directory: AbsolutePath.make(input.directory),
                    workspaceID: input.workspaceID,
                  },
                },
              )
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
      const result = yield* SynchronizedRef.modify(state, (current): readonly [RespondResult, State] => {
        const pending = current.pending.get(input.requestID)
        if (!pending) return [{ _tag: "Missing" as const }, current]
        const registration = current.registrations.get(input.clientID)
        if (
          !registration ||
          !registrationLive(registration) ||
          registration.token !== input.token ||
          pending.token !== input.token ||
          pending.clientID !== input.clientID
        ) {
          return [{ _tag: "Unauthorized" as const, pending }, current]
        }
        if (pending.operation !== input.operation) {
          return [{ _tag: "Mismatched" as const, pending }, current]
        }
        const entries = new Map(current.pending)
        entries.delete(input.requestID)
        return [
          { _tag: "Matched" as const, pending },
          { ...current, pending: entries },
        ]
      })

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

    return Service.of({ register, unregister, capabilities, request, respond })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer))

function scopeMatches(registration: Registration, scope: Scope) {
  if (registration.directory !== scope.directory) return false
  if (scope.workspaceID === undefined) return registration.workspaceID === undefined
  return registration.workspaceID === undefined || registration.workspaceID === scope.workspaceID
}

function selectRegistration(registrations: Map<ClientID, Registration>, scope: Scope, operation: Operation) {
  const matches = Array.from(registrations.values())
    .filter((registration) => registrationLive(registration) && scopeMatches(registration, scope) && registration.capabilities.includes(operation))
    .toReversed()
  return matches.find((registration) => registration.workspaceID === scope.workspaceID) ?? matches[0]
}

function registrationLive(registration: Registration) {
  return registration.expiresAt === undefined || registration.expiresAt > Date.now()
}

export * as GuiBridge from "./gui-bridge"
