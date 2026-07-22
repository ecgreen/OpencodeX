import type { Deferred } from "effect"
import type {
  ClientID,
  LeaseGeneration,
  Operation,
  RequestID,
  RequestInput,
  RemoteError,
  ResponseOutput,
  Scope,
  Token,
  UnavailableError,
} from "./gui-bridge"
import type { SessionID } from "@/session/schema"

export interface Lease {
  readonly clientID: ClientID
  readonly token: Token
  readonly generation: LeaseGeneration
  readonly capabilities: ReadonlyArray<Operation>
  readonly scopes: Map<string, Scope>
  readonly expiresAt?: number
}

interface ScopeClients {
  readonly scope: Scope
  readonly clientIDs: ReadonlySet<ClientID>
}

export interface Pending {
  readonly requestID: RequestID
  readonly clientID: ClientID
  readonly token: Token
  readonly scope: Scope
  readonly operation: Operation
  readonly sessionID: SessionID
  readonly input: RequestInput
  readonly deferred: Deferred.Deferred<ResponseOutput, RemoteError | UnavailableError>
}

export interface State {
  readonly registrations: Map<ClientID, Lease>
  readonly scopes: Map<string, ScopeClients>
  readonly pending: Map<RequestID, Pending>
}

export function scopeKey(scope: Scope) {
  return JSON.stringify([scope.directory, scope.workspaceID ?? null])
}

function scopeMatches(registered: Scope, requested: Scope) {
  if (registered.directory !== requested.directory) return false
  if (requested.workspaceID === undefined) return registered.workspaceID === undefined
  return registered.workspaceID === undefined || registered.workspaceID === requested.workspaceID
}

export function supports(registration: Lease, scope: Scope, operation: Operation) {
  return registration.capabilities.includes(operation) && Array.from(registration.scopes.values()).some((item) => scopeMatches(item, scope))
}

function candidateScopeKeys(scope: Scope) {
  if (scope.workspaceID === undefined) return [scopeKey(scope)]
  return [scopeKey(scope), scopeKey({ directory: scope.directory })]
}

export function selectRegistration(state: State, scope: Scope, operation: Operation) {
  const registrations = Array.from(state.registrations.values()).toReversed()
  return candidateScopeKeys(scope)
    .flatMap((key) => {
      const clients = state.scopes.get(key)?.clientIDs
      if (!clients) return []
      return registrations.find((registration) => clients.has(registration.clientID) && registration.capabilities.includes(operation)) ?? []
    })[0]
}

export function capabilitiesFor(state: State, scope: Scope) {
  return Array.from(
    new Set(
      candidateScopeKeys(scope)
        .flatMap((key) => Array.from(state.scopes.get(key)?.clientIDs ?? []))
        .flatMap((clientID) => state.registrations.get(clientID)?.capabilities ?? []),
    ),
  )
}

export function syncScopeIndex(
  current: Map<string, ScopeClients>,
  clientID: ClientID,
  previous: Map<string, Scope>,
  desired: Map<string, Scope>,
) {
  const scopes = new Map(current)
  Array.from(previous.keys()).filter((key) => !desired.has(key)).forEach((key) => {
    const clientIDs = new Set(scopes.get(key)?.clientIDs ?? [])
    const scope = previous.get(key)
    clientIDs.delete(clientID)
    if (clientIDs.size === 0) scopes.delete(key)
    else if (scope) scopes.set(key, { scope, clientIDs })
  })
  Array.from(desired.entries()).filter(([key]) => !previous.has(key)).forEach(([key, scope]) => {
    const clientIDs = new Set(scopes.get(key)?.clientIDs ?? [])
    clientIDs.add(clientID)
    scopes.set(key, { scope, clientIDs })
  })
  return scopes
}

export function removeClientFromScopes(current: Map<string, ScopeClients>, clientID: ClientID) {
  return new Map(
    Array.from(current.entries()).flatMap(([key, scope]) => {
      const clientIDs = new Set(Array.from(scope.clientIDs).filter((item) => item !== clientID))
      return clientIDs.size === 0 ? [] : [[key, { ...scope, clientIDs }] as const]
    }),
  )
}

export function prune(current: State, now: number) {
  const expired = new Set(
    Array.from(current.registrations.values())
      .filter((registration) => registration.expiresAt !== undefined && registration.expiresAt <= now)
      .map((registration) => registration.clientID),
  )
  if (expired.size === 0) return { state: current, invalidated: [] as Pending[] }
  const invalidated = Array.from(current.pending.values()).filter((item) => expired.has(item.clientID))
  const invalidatedIDs = new Set(invalidated.map((item) => item.requestID))
  return {
    state: {
      registrations: new Map(Array.from(current.registrations).filter(([clientID]) => !expired.has(clientID))),
      scopes: new Map(
        Array.from(current.scopes).flatMap(([key, scope]) => {
          const clientIDs = new Set(Array.from(scope.clientIDs).filter((clientID) => !expired.has(clientID)))
          return clientIDs.size === 0 ? [] : [[key, { ...scope, clientIDs }] as const]
        }),
      ),
      pending: new Map(Array.from(current.pending).filter(([requestID]) => !invalidatedIDs.has(requestID))),
    },
    invalidated,
  }
}
