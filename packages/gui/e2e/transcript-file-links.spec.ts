import { expect, test, type APIRequestContext } from "@playwright/test"
import path from "node:path"

const backendURL = "http://127.0.0.1:4097"
const workspaceDirectory = path.resolve(import.meta.dirname, "../../..")
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": workspaceDirectory,
}

const specPath = "docs/superpowers/specs/2026-08-10-selection-highlight-and-context-menu-design.md"
const markdown = [
  `The spec lives at \`${specPath}\` and there is`,
  "also `https://example.com/docs/page.md` for external reference.",
  "",
  "```",
  "see packages/gui/src/main/index.ts inside a fence",
  "```",
  "",
  "Plain readable sentence for selection contrast checks with enough words to drag across comfortably.",
].join("\n")

async function createSeededSession(request: APIRequestContext, title: string) {
  const projectResponse = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: title, directory: workspaceDirectory, folders: [workspaceDirectory] },
  })
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
  const project = (await projectResponse.json()) as { id: string }
  const sessionResponse = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID: project.id, directory: workspaceDirectory, title },
  })
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  const session = (await sessionResponse.json()) as { id: string }
  const messageResponse = await request.post(`${backendURL}/session/${session.id}/message`, {
    headers,
    data: {
      agent: "build",
      model: { providerID: "test", modelID: "test-model" },
      noReply: true,
      parts: [{ type: "text", text: markdown }],
    },
  })
  expect(messageResponse.ok(), await messageResponse.text()).toBe(true)
  return { title }
}

for (const theme of ["dark", "light"] as const) {
  test(`selection tint and transcript file links in ${theme}`, async ({ page, request }, testInfo) => {
    const expected = theme === "dark" ? "rgba(250, 178, 131, 0.3)" : "rgba(156, 68, 24, 0.28)"
    const { title } = await createSeededSession(request, `File Links Verify ${theme} ${testInfo.retry}-${Date.now()}`)

    await page.emulateMedia({ colorScheme: theme })
    await page.addInitScript((mode) => localStorage.setItem("opencodex.gui.theme", mode), theme)
    await page.goto("/")
    await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
    const card = page.locator(".session-link-shell", { hasText: title }).first()
    await card.locator(".session-link").click()
    await expect(page.locator(".session-page")).toBeVisible()

    const transcriptText = page.locator(".part.text").filter({ hasText: "Plain readable sentence" }).first()
    await expect(transcriptText).toBeVisible()

    const fileLink = page.locator(`code[data-side-panel-open-file="${specPath}"]`)
    await expect(fileLink).toBeVisible()
    expect(await fileLink.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer")
    await expect(page.locator("a.external-link code", { hasText: "example.com" })).toHaveCount(1)
    expect(await page.locator("a.external-link code[data-side-panel-open-file]").count()).toBe(0)
    expect(await page.locator("pre code[data-side-panel-open-file]").count()).toBe(0)

    const selectionBackground = await transcriptText.evaluate((el) =>
      getComputedStyle(el, "::selection").backgroundColor,
    )
    expect(selectionBackground).toBe(expected)

    // Simulate morphdom's end-of-stream attribute strip: it syncs attributes
    // on an otherwise-identical node (removing our stamp) without any
    // childList/characterData mutation. The MutationObserver installed by
    // observeTranscriptFileLinks must also watch attribute changes to heal
    // this, or the link goes permanently dead once streaming ends.
    await fileLink.evaluate((el) => el.removeAttribute("data-side-panel-open-file"))
    await expect(fileLink).toHaveAttribute("data-side-panel-open-file", specPath)

    await fileLink.click()
    await expect(page.locator(".session-side-panel")).toBeVisible()
    await expect(page.locator(".session-open-file-breadcrumb")).toContainText("context-menu-design.md")
  })
}
