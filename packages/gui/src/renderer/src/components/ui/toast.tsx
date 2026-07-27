import type { JSX } from "solid-js"
import { For, Show, createContext, createSignal, onCleanup, useContext } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "../icon"
import { IconButton } from "./button"
import type { ControlTone } from "./shared"

export type ToastTone = Exclude<ControlTone, "neutral">

export type ToastOptions = {
  title: JSX.Element
  detail?: JSX.Element
  tone?: ToastTone
  /** Milliseconds before auto-dismiss. Pass 0 to require an explicit dismiss. */
  duration?: number
  action?: { label: string; onSelect: () => void }
}

type ToastEntry = ToastOptions & { id: number }

const TONE_ICONS: Record<ToastTone, string> = {
  accent: "activity",
  info: "activity",
  success: "check",
  warning: "warning",
  danger: "warning",
}

const ToastContext = createContext<{ push: (options: ToastOptions) => number; dismiss: (id: number) => void }>()

/** Mount once near the app root. Toasts report the outcome of async work. */
export function ToastProvider(props: { children: JSX.Element }) {
  const [toasts, setToasts] = createSignal<ToastEntry[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let nextId = 0

  const dismiss = (id: number) => {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }

  const push = (options: ToastOptions) => {
    const id = nextId++
    setToasts((current) => [...current, { ...options, id }])
    const duration = options.duration ?? 6000
    if (duration > 0) timers.set(id, setTimeout(() => dismiss(id), duration))
    return id
  }

  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  })

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {props.children}
      <Portal>
        <ToastViewport toasts={toasts()} onDismiss={dismiss} />
      </Portal>
    </ToastContext.Provider>
  )
}

export function ToastViewport(props: { toasts: ToastEntry[]; onDismiss: (id: number) => void }) {
  return (
    <Show when={props.toasts.length > 0}>
      <div class="ui-toast-viewport" role="region" aria-label="Notifications">
        <For each={props.toasts}>{(toast) => <Toast toast={toast} onDismiss={() => props.onDismiss(toast.id)} />}</For>
      </div>
    </Show>
  )
}

export function Toast(props: { toast: ToastEntry; onDismiss: () => void }) {
  const tone = () => props.toast.tone ?? "info"
  return (
    <div class="ui-toast" data-tone={tone()} role={tone() === "danger" ? "alert" : "status"}>
      <span class="ui-toast-icon" aria-hidden="true">
        <Icon name={TONE_ICONS[tone()]} />
      </span>
      <div class="ui-toast-body">
        <span class="ui-toast-title">{props.toast.title}</span>
        <Show when={props.toast.detail}>{(detail) => <span class="ui-toast-detail">{detail()}</span>}</Show>
      </div>
      <div class="ui-toast-actions">
        <Show when={props.toast.action}>
          {(action) => (
            <button type="button" class="ui-tab" onClick={() => { action().onSelect(); props.onDismiss() }}>
              {action().label}
            </button>
          )}
        </Show>
        <IconButton appearance="ghost" size="compact" icon="x" label="Dismiss notification" onClick={props.onDismiss} />
      </div>
    </div>
  )
}

/** Throws outside a ToastProvider so a missing provider fails loudly in dev. */
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error("useToast requires a ToastProvider ancestor")
  return context
}
