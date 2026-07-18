import { render } from "solid-js/web"
import { App } from "./app"
import "./styles.css"

const root = document.getElementById("root")!

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("design-lab")) {
  void import("./components/design-system-lab").then((module) => {
    const DesignSystemLab = module.DesignSystemLab
    render(() => <DesignSystemLab />, root)
  })
} else {
  render(() => <App />, root)
}
