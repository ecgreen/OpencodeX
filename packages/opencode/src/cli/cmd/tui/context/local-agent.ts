import { RGBA } from "@opentui/core"
import { batch, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import type { useSync } from "@tui/context/sync"
import type { useToast } from "../ui/toast"

export function createLocalAgent(sync: ReturnType<typeof useSync>, toast: ReturnType<typeof useToast>) {
  const agents = createMemo(() => sync.data.agent.filter((agent) => agent.mode !== "subagent" && !agent.hidden))
  const visibleAgents = createMemo(() => sync.data.agent.filter((agent) => !agent.hidden))
  const [store, setStore] = createStore({
    current: undefined as string | undefined,
    session: {} as Record<string, string | undefined>,
  })
  const themeState = useTheme()
  const colors = createMemo(() => [
    themeState.theme.secondary,
    themeState.theme.accent,
    themeState.theme.success,
    themeState.theme.warning,
    themeState.theme.primary,
    themeState.theme.error,
    themeState.theme.info,
  ])

  const warnMissing = (name: string) =>
    toast.show({
      variant: "warning",
      message: `Agent not found: ${name}`,
      duration: 3000,
    })

  const current = () => agents().find((agent) => agent.name === store.current) ?? agents().at(0)
  const currentForSession = (sessionID: string | undefined) => {
    if (!sessionID) return undefined
    return agents().find((agent) => agent.name === store.session[sessionID])
  }

  return {
    list: agents,
    current,
    currentForSession,
    set(name: string) {
      if (!agents().some((agent) => agent.name === name)) return warnMissing(name)
      setStore("current", name)
    },
    setSession(sessionID: string, name: string) {
      if (!agents().some((agent) => agent.name === name)) return warnMissing(name)
      setStore("session", sessionID, name)
    },
    move(direction: 1 | -1) {
      batch(() => {
        const selected = current()
        if (!selected || !agents().length) return
        const index = agents().findIndex((agent) => agent.name === selected.name)
        setStore("current", agents()[(index + direction + agents().length) % agents().length]?.name)
      })
    },
    moveSession(sessionID: string, direction: 1 | -1, currentName?: string) {
      batch(() => {
        const selected =
          agents().find((agent) => agent.name === currentName) ?? currentForSession(sessionID) ?? current()
        if (!selected || !agents().length) return
        const index = agents().findIndex((agent) => agent.name === selected.name)
        setStore("session", sessionID, agents()[(index + direction + agents().length) % agents().length]?.name)
      })
    },
    color(name: string) {
      const index = visibleAgents().findIndex((agent) => agent.name === name)
      if (index === -1) return colors()[0]
      const agent = visibleAgents()[index]
      if (agent?.color) {
        if (agent.color.startsWith("#")) return RGBA.fromHex(agent.color)
        return themeState.theme[agent.color as keyof typeof themeState.theme] as RGBA
      }
      return colors()[index % colors().length]
    },
  }
}

export type LocalAgent = ReturnType<typeof createLocalAgent>
