import { app } from "electron"
import { readInstallationID } from "./installation-id-store.js"

export { isUUID, readInstallationID } from "./installation-id-store.js"

let pending: Promise<string> | undefined

export function installationID() {
  // Drop the memo on failure: caching a rejected promise would turn one
  // transient filesystem error into "broken until restart".
  return (pending ??= readInstallationID(app.getPath("userData")).catch((error) => {
    pending = undefined
    throw error
  }))
}
