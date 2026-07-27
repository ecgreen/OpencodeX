import { createSignal } from "solid-js"

type PendingProjectSession = {
  projectID: string
  directory: string
}

type PendingSwarmTask = {
  swarmID: string
  title: string
}

const [pendingProjectSession, setPendingProjectSession] = createSignal<PendingProjectSession | undefined>()
const [pendingSwarmTask, setPendingSwarmTask] = createSignal<PendingSwarmTask | undefined>()

export function getPendingOpencodeXProjectSession() {
  return pendingProjectSession()
}

export function setPendingOpencodeXProjectSession(input: PendingProjectSession | undefined) {
  setPendingProjectSession(input)
}

export function getPendingOpencodeXSwarmTask() {
  return pendingSwarmTask()
}

export function setPendingOpencodeXSwarmTask(input: PendingSwarmTask | undefined) {
  setPendingSwarmTask(input)
}
