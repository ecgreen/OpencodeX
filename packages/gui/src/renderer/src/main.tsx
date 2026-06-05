import { render } from "solid-js/web"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { App } from "./app"
import "./styles.css"

render(() => <MarkedProvider><App /></MarkedProvider>, document.getElementById("root")!)
