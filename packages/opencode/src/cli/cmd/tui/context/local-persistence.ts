import path from "path"
import { Global } from "@opencode-ai/core/global"
import { create } from "@opencode-ai/core/util/log"
import { onCleanup } from "solid-js"
import { Filesystem } from "@/util/filesystem"

const log = create({ service: "tui.local" })

export function createLocalPersistence(input: {
  file: string
  ready: () => boolean
  setReady: () => void
  hydrate: (value: unknown) => void
  serialize: () => unknown
}) {
  const file = path.join(Global.Path.state, input.file)
  let pending = false
  let disposed = false

  onCleanup(() => {
    disposed = true
  })

  const save = () => {
    if (disposed) return
    if (!input.ready()) {
      pending = true
      return
    }
    pending = false
    void Filesystem.writeJson(file, input.serialize()).catch((error) => {
      log.warn("failed to persist tui local state", { file, error })
    })
  }

  void Filesystem.readJson(file)
    .then((value) => {
      if (!disposed) input.hydrate(value)
    })
    .catch(() => {})
    .finally(() => {
      if (disposed) return
      input.setReady()
      if (pending) save()
    })

  return save
}
