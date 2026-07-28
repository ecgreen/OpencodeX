import { For, Match, Show, Switch, createEffect, createSignal } from "solid-js"
import { Button, SegmentedControl, ToastProvider } from "../ui"
import { LabControls } from "./lab-controls"
import { LabFeedback } from "./lab-feedback"
import { LabFoundations } from "./lab-foundations"
import { LabNavigation } from "./lab-navigation"
import { LabOverlays } from "./lab-overlays"
import { LabSafety } from "./lab-safety"
import { LabSignature } from "./lab-signature"
import { LabTranscript } from "./lab-transcript"
import { LabWorkspace } from "./lab-workspace"
import { LAB_PAGES, type LabPageId } from "./lab-shared"
import styles from "./lab.module.css"

type ThemeMode = "dark" | "light"

const isPage = (value: string | null): value is LabPageId => LAB_PAGES.some((page) => page.id === value)

/**
 * The component gallery. Runs standalone in a browser (lab.html) so the design
 * system can be iterated on without launching Electron.
 */
export function LabApp() {
  const params = new URLSearchParams(window.location.search)
  const initialPage = params.get("page")
  const [page, setPage] = createSignal<LabPageId>(isPage(initialPage) ? initialPage : "foundations")
  const [theme, setTheme] = createSignal<ThemeMode>(params.get("theme") === "light" ? "light" : "dark")

  createEffect(() => {
    document.documentElement.dataset.theme = theme()
  })

  // Keep the URL shareable so a specific page and theme can be linked directly.
  createEffect(() => {
    const next = new URLSearchParams({ page: page(), theme: theme() })
    window.history.replaceState(null, "", `?${next.toString()}`)
  })

  const active = () => LAB_PAGES.find((item) => item.id === page())!

  return (
    <ToastProvider>
      <div class={styles.lab}>
        <nav class={styles.rail} aria-label="Component library">
          <div class={styles.brand}>
            <span class={styles.brandDetail}>OpencodeX</span>
            <span class={styles.brandTitle}>Design system</span>
          </div>
          <For each={LAB_PAGES}>
            {(item) => (
              <button type="button" class={styles.navItem} data-active={item.id === page()} onClick={() => setPage(item.id)}>
                <span class={styles.navLabel}>{item.label}</span>
                <span class={styles.navDetail}>{item.detail}</span>
              </button>
            )}
          </For>
          <div class={styles.railFooter}>
            <SegmentedControl<ThemeMode>
              label="Theme"
              value={theme()}
              onChange={setTheme}
              items={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
            <Button appearance="ghost" size="compact" leadingIcon="external" onClick={() => window.open("https://github.com/ecgreen/OpencodeX", "_blank", "noopener")}>
              Repository
            </Button>
          </div>
        </nav>

        <main class={styles.main}>
          <header class={styles.pageHeader}>
            <h1 class={styles.pageTitle}>{active().label}</h1>
            <p class={styles.pageDetail}>{active().detail}</p>
          </header>
          <Switch>
            <Match when={page() === "foundations"}><LabFoundations /></Match>
            <Match when={page() === "controls"}><LabControls /></Match>
            <Match when={page() === "feedback"}><LabFeedback /></Match>
            <Match when={page() === "navigation"}><LabNavigation /></Match>
            <Match when={page() === "overlays"}><LabOverlays /></Match>
            <Match when={page() === "safety"}><LabSafety /></Match>
            <Match when={page() === "signature"}><LabSignature /></Match>
            <Match when={page() === "transcript"}><LabTranscript /></Match>
            <Match when={page() === "workspace"}><LabWorkspace /></Match>
          </Switch>
          <Show when={page() === "foundations"}>
            <p class={styles.pageDetail}>
              Every specimen on these pages renders the real component from <code>components/ui</code>. What you see here
              is what ships.
            </p>
          </Show>
        </main>
      </div>
    </ToastProvider>
  )
}
