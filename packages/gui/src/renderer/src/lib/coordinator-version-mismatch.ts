import { COORDINATOR_VERSION_MISMATCH } from "../../../shared/connection"

export function canAttachCoordinatorAnyway(error: unknown) {
  if (!error || typeof error !== "object") return false
  return Reflect.get(error, "code") === COORDINATOR_VERSION_MISMATCH
}
