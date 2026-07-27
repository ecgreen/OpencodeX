import { render } from "solid-js/web"
import { LabApp } from "./components/lab/lab-app"
import "./styles.css"

/**
 * Standalone entry for the component lab. Served by `bun run dev:lab` at
 * /lab.html; it never loads the Electron app model, so the library can be
 * iterated on in a plain browser.
 */
render(() => <LabApp />, document.getElementById("root")!)
