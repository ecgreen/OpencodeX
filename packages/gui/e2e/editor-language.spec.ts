import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fixtureDirectory } from "./fixture-directory"

const backendURL = "http://127.0.0.1:4097"
const projectDirectory = path.join(fixtureDirectory, "packages", "app")
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": projectDirectory,
}
const title = `Editor Language ${path.basename(fixtureDirectory)}`

test("provides TSX hover and completion from a hoisted dependency", async ({ page, request }) => {
  await createFixture(request)
  await page.goto("/")
  const card = page.locator(".session-link-shell", { hasText: title }).first()
  await expect(card).toBeVisible()
  await card.locator(".session-link").click()
  await expect(page.locator(".session-page")).toBeVisible()
  await page.getByRole("button", { name: "Open side panel" }).click()
  await page.getByRole("button", { name: "Open file" }).click()
  const search = page.getByRole("searchbox", { name: "Filter files" })
  const result = page.locator(".workbench-search-row", { hasText: "app.tsx" })
  await expect(async () => {
    await search.fill("app.tsx")
    await expect(result).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  await result.click()
  await expect(page.locator(".workbench-codemirror .cm-content")).toContainText("console.log(answer)")

  await hoverText(page, "answer", 2)
  const hover = page.locator(".cm-tooltip-hover .code-editor-hover")
  await expect(hover).toBeVisible()
  await expect(hover).toContainText("answer")
  await expect(hover).toContainText("number")

  await clickAfterLine(page, 3)
  await page.keyboard.press("Control+Space")
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("run")
  await page.keyboard.press("Escape")
})

async function createFixture(request: APIRequestContext) {
  await mkdir(path.join(projectDirectory, "src"), { recursive: true })
  await mkdir(path.join(fixtureDirectory, "node_modules", "fixture-library"), { recursive: true })
  await writeFile(path.join(projectDirectory, "bun.lock"), "")
  await writeFile(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({ name: "fixture-app", dependencies: { "fixture-library": "1.0.0" } }),
  )
  await writeFile(
    path.join(projectDirectory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        jsx: "preserve",
        moduleResolution: "node",
        baseUrl: ".",
        paths: { "fixture-library": ["../../node_modules/fixture-library"] },
      },
    }),
  )
  await writeFile(
    path.join(projectDirectory, "src", "app.tsx"),
    [
      'import { answer, createThing } from "fixture-library"',
      "const item = createThing()",
      "console.log(answer)",
      "item.",
      "export function App() { return <div>{answer}</div> }",
      "",
    ].join("\n"),
  )
  await writeFile(
    path.join(fixtureDirectory, "node_modules", "fixture-library", "package.json"),
    JSON.stringify({
      name: "fixture-library",
      version: "1.0.0",
      types: "index.d.ts",
    }),
  )
  await writeFile(
    path.join(fixtureDirectory, "node_modules", "fixture-library", "index.d.ts"),
    [
      "export declare const answer: number",
      "export interface FixtureThing { run(): string; stop(): void }",
      "export declare function createThing(): FixtureThing",
      "",
    ].join("\n"),
  )
  const project = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: "Editor Language", directory: projectDirectory, folders: [projectDirectory, fixtureDirectory] },
  })
  expect(project.ok(), await project.text()).toBe(true)
  const body = (await project.json()) as { id: string }
  const session = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID: body.id, directory: projectDirectory, title },
  })
  expect(session.ok(), await session.text()).toBe(true)
}

async function hoverText(page: Page, text: string, line: number) {
  const point = await textPoint(page, text, line)
  await page.mouse.move(point.x, point.y)
}

async function clickAfterLine(page: Page, line: number) {
  const point = await page
    .locator(".workbench-codemirror .cm-line")
    .nth(line)
    .evaluate((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const nodes: Node[] = []
      while (walker.nextNode()) nodes.push(walker.currentNode)
      const node = nodes.findLast((item) => item.textContent)
      if (!node?.textContent) return
      const range = document.createRange()
      range.setStart(node, node.textContent.length - 1)
      range.setEnd(node, node.textContent.length)
      const rect = range.getBoundingClientRect()
      return { x: rect.right - 1, y: rect.top + rect.height / 2 }
    })
  if (!point) throw new Error(`Could not find editor line ${line + 1}`)
  await page.mouse.click(point.x, point.y)
}

async function textPoint(page: Page, text: string, line: number) {
  const point = await page
    .locator(".workbench-codemirror .cm-line")
    .nth(line)
    .evaluate((root, value) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        const offset = (node.textContent ?? "").indexOf(value)
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + value.length)
        const rect = range.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
    }, text)
  if (!point) throw new Error(`Could not find ${text} on editor line ${line + 1}`)
  return point
}
