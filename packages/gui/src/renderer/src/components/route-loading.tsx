import { For, Match, Switch } from "solid-js"
import type { Route } from "../lib/routes"
import { routeLayoutMode } from "../lib/routes"
import { Skeleton } from "./ui"
import { AppLoadingSkeleton } from "./app-loading"

/**
 * Placeholder shown while a route's lazy chunk loads.
 *
 * It matches the shape of the route being opened. A single dashboard-shaped
 * fallback made every other navigation flash a page that was never going to
 * appear, which read as a glitch rather than as loading.
 *
 * The fade-in is delayed (see route-loading.css), so a chunk that resolves
 * quickly shows nothing at all instead of a blink.
 */
export function RouteLoadingSkeleton(props: { route: Route }) {
  return (
    <Switch fallback={<ManagerPageSkeleton />}>
      <Match when={props.route.name === "dashboard"}>
        <AppLoadingSkeleton />
      </Match>
      <Match when={routeLayoutMode(props.route) === "full-bleed"}>
        <WorkspaceSkeleton />
      </Match>
    </Switch>
  )
}

/** Header, toolbar, and card grid: the scrolling manager-page layout. */
function ManagerPageSkeleton() {
  return (
    <div class="page route-loading route-loading-manager" aria-busy="true" aria-label="Loading page">
      <header class="route-loading-header">
        <Skeleton shape="title" width="min(280px, 40%)" />
        <Skeleton shape="text" width="min(420px, 62%)" />
      </header>
      <div class="route-loading-toolbar">
        <Skeleton shape="text" width="180px" />
        <Skeleton shape="text" width="96px" />
      </div>
      <div class="route-loading-grid">
        <For each={[0, 1, 2, 3, 4, 5]}>
          {() => (
            <div class="route-loading-card">
              <Skeleton shape="text" width="64%" />
              <Skeleton shape="text" width="42%" />
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

/** Toolbar plus a single full-height surface: the full-bleed workspace layout. */
function WorkspaceSkeleton() {
  return (
    <div class="route-loading route-loading-workspace" aria-busy="true" aria-label="Loading workspace">
      <div class="route-loading-toolbar">
        <Skeleton shape="text" width="220px" />
        <Skeleton shape="text" width="120px" />
      </div>
      <div class="route-loading-surface" />
    </div>
  )
}
