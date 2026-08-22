export const COORDINATOR_VERSION_MISMATCH = "COORDINATOR_VERSION_MISMATCH"

export type GuiConnection = {
  url: string
  directory?: string
}

export type GuiConnectionResult =
  | { ok: true; value: GuiConnection }
  | { ok: false; error: { message: string; code?: typeof COORDINATOR_VERSION_MISMATCH } }
