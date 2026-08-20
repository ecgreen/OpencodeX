import {
  COORDINATOR_VERSION_MISMATCH,
  type GuiConnectionResult,
} from "../shared/connection.js"
import { CoordinatorVersionMismatchError } from "./sidecar-state.js"

export function failedGuiConnection(error: unknown): GuiConnectionResult {
  if (error instanceof CoordinatorVersionMismatchError) {
    return {
      ok: false,
      error: {
        message: "The coordinator version does not match this OpencodeX GUI.",
        code: COORDINATOR_VERSION_MISMATCH,
      },
    }
  }
  return { ok: false, error: { message: "Unable to connect to the OpencodeX backend." } }
}
