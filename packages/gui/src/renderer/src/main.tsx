import { render } from "solid-js/web"
import { App } from "./app"
import {
  RENDERER_PERFORMANCE_MARKS,
  RENDERER_PERFORMANCE_MEASURES,
  markPerformance,
  measurePerformance,
} from "./lib/performance"
import "./styles.css"

markPerformance(RENDERER_PERFORMANCE_MARKS.bootstrap)

const root = document.getElementById("root")!

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("design-lab")) {
  void import("./components/design-system-lab").then((module) => {
    const DesignSystemLab = module.DesignSystemLab
    render(() => <DesignSystemLab />, root)
  })
} else {
  render(() => <App />, root)
  markPerformance(RENDERER_PERFORMANCE_MARKS.appMounted)
  measurePerformance(
    RENDERER_PERFORMANCE_MEASURES.bootstrapToAppMounted,
    RENDERER_PERFORMANCE_MARKS.bootstrap,
    RENDERER_PERFORMANCE_MARKS.appMounted,
  )
}
