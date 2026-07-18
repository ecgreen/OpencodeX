import { StreamLanguage } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import { workbenchLanguageID } from "../lib/workbench"

export async function loadCodeEditorLanguage(file: string): Promise<Extension> {
  const language = workbenchLanguageID(file)
  const extension = file.toLowerCase().split(".").at(-1) ?? ""
  if (language === "javascript")
    return import("@codemirror/lang-javascript").then((module) =>
      module.javascript({ jsx: ["jsx", "tsx"].includes(extension), typescript: ["ts", "tsx"].includes(extension) }),
    )
  if (language === "css") return import("@codemirror/lang-css").then((module) => module.css())
  if (language === "html") return import("@codemirror/lang-html").then((module) => module.html())
  if (language === "json") return import("@codemirror/lang-json").then((module) => module.json())
  if (language === "markdown") return import("@codemirror/lang-markdown").then((module) => module.markdown())
  if (language === "python") return import("@codemirror/lang-python").then((module) => module.python())
  if (language === "rust") return import("@codemirror/lang-rust").then((module) => module.rust())
  if (language === "yaml") return import("@codemirror/lang-yaml").then((module) => module.yaml())
  if (language === "shell")
    return import("@codemirror/legacy-modes/mode/shell").then((module) => StreamLanguage.define(module.shell))
  if (language === "powershell")
    return import("@codemirror/legacy-modes/mode/powershell").then((module) => StreamLanguage.define(module.powerShell))
  if (language === "toml")
    return import("@codemirror/legacy-modes/mode/toml").then((module) => StreamLanguage.define(module.toml))
  if (language === "sql")
    return import("@codemirror/legacy-modes/mode/sql").then((module) => StreamLanguage.define(module.standardSQL))
  if (language === "go")
    return import("@codemirror/legacy-modes/mode/go").then((module) => StreamLanguage.define(module.go))
  if (language === "ruby")
    return import("@codemirror/legacy-modes/mode/ruby").then((module) => StreamLanguage.define(module.ruby))
  if (language === "lua")
    return import("@codemirror/legacy-modes/mode/lua").then((module) => StreamLanguage.define(module.lua))
  if (language === "c")
    return import("@codemirror/legacy-modes/mode/clike").then((module) => StreamLanguage.define(module.c))
  if (language === "cpp")
    return import("@codemirror/legacy-modes/mode/clike").then((module) => StreamLanguage.define(module.cpp))
  if (language === "java")
    return import("@codemirror/legacy-modes/mode/clike").then((module) => StreamLanguage.define(module.java))
  if (language === "csharp")
    return import("@codemirror/legacy-modes/mode/clike").then((module) => StreamLanguage.define(module.csharp))
  if (language === "kotlin")
    return import("@codemirror/legacy-modes/mode/clike").then((module) => StreamLanguage.define(module.kotlin))
  if (language === "scala")
    return import("@codemirror/legacy-modes/mode/clike").then((module) => StreamLanguage.define(module.scala))
  if (language === "dart")
    return import("@codemirror/legacy-modes/mode/clike").then((module) => StreamLanguage.define(module.dart))
  if (language === "dockerfile")
    return import("@codemirror/legacy-modes/mode/dockerfile").then((module) => StreamLanguage.define(module.dockerFile))
  if (language === "diff")
    return import("@codemirror/legacy-modes/mode/diff").then((module) => StreamLanguage.define(module.diff))
  if (language === "properties")
    return import("@codemirror/legacy-modes/mode/properties").then((module) => StreamLanguage.define(module.properties))
  return []
}
