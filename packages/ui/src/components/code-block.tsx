import type { ComponentProps } from "solid-js"
import type { BundledLanguage } from "shiki"
import { getSharedHighlighter } from "@pierre/diffs"
import { bundledLanguages } from "shiki"
import DOMPurify from "dompurify"
import { createMemo, createResource, splitProps } from "solid-js"
import "../context/marked"

const sanitizeConfig = {
  USE_PROFILES: { html: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
}

const aliases: Record<string, string> = {
  shell: "bash",
  sh: "bash",
  ps: "powershell",
  pwsh: "powershell",
  text: "text",
}

function escape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fallback(code: string) {
  return `<pre><code>${escape(code)}</code></pre>`
}

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, sanitizeConfig)
}

function normalizeLanguage(language: string | undefined) {
  const value = (language || "text").toLowerCase()
  const normalized = aliases[value] ?? value
  return normalized in bundledLanguages ? normalized : "text"
}

async function highlight(code: string, language: string) {
  const highlighter = await getSharedHighlighter({
    themes: ["OpenCode"],
    langs: [],
    preferredHighlighter: "shiki-wasm",
  })
  if (!highlighter.getLoadedLanguages().includes(language)) {
    await highlighter.loadLanguage(language as BundledLanguage)
  }
  return sanitize(highlighter.codeToHtml(code, { lang: language, theme: "OpenCode", tabindex: false })) || fallback(code)
}

export function CodeBlock(props: ComponentProps<"div"> & { code: string; language?: string }) {
  const [local, others] = splitProps(props, ["code", "language", "class", "classList"])
  const source = createMemo(() => ({ code: local.code, language: normalizeLanguage(local.language) }))
  const [html] = createResource(source, (value) => highlight(value.code, value.language), {
    initialValue: fallback(local.code),
  })

  return (
    <div
      data-component="code-block"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      innerHTML={html.latest ?? html() ?? fallback(local.code)}
      {...others}
    />
  )
}
