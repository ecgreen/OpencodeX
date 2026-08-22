export type CoordinatorIdentity = { key: string; token: string }

export function createCoordinatorMismatchApproval() {
  let pending: CoordinatorIdentity | undefined
  let approved: CoordinatorIdentity | undefined
  return {
    observe(identity: CoordinatorIdentity) {
      pending = identity
      approved = undefined
    },
    pending() {
      return pending ? { ...pending } : undefined
    },
    approve(identity: CoordinatorIdentity) {
      if (!pending) throw new Error("No coordinator version mismatch is pending.")
      if (pending.key !== identity.key || pending.token !== identity.token) {
        throw new Error("The pending coordinator version mismatch changed.")
      }
      approved = pending
      pending = undefined
    },
    consume(identity: CoordinatorIdentity) {
      const matches = approved?.key === identity.key && approved.token === identity.token
      approved = undefined
      return matches
    },
    clear() {
      pending = undefined
      approved = undefined
    },
  }
}

export class CoordinatorVersionMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CoordinatorVersionMismatchError"
  }
}
