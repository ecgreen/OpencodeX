import { createSignal } from "solid-js"

type PendingProjectSession = {
  projectID: string
  directory: string
}

const [pendingProjectSession, setPendingProjectSession] = createSignal<PendingProjectSession | undefined>()

export function getPendingOpencodeXProjectSession() {
  return pendingProjectSession()
}

export function setPendingOpencodeXProjectSession(input: PendingProjectSession | undefined) {
  setPendingProjectSession(input)
}
