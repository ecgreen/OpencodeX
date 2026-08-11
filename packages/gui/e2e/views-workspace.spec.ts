import { expect, test, type APIRequestContext } from "@playwright/test"
import path from "node:path"

/**
 * A view's workspace is the session workspace, pointed at whichever session the
 * view is prioritising - so it collapses its centre by the same rules, and
 * closing it brings the panes back rather than leaving an empty window.
 */

const backendURL = "http://127.0.0.1:4097"
const workspaceDirectory = path.resolve(import.meta.dirname, "../../..")
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": workspaceDirectory,
}

test("a view's workspace can take the window, and giving it back restores the panes", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000)
  const suffix = `${path.basename(workspaceDirectory)}-${testInfo.retry}-${Date.now()}`
  const project = await createProject(request, suffix)
  // The titles carry the project id because the picker searches titles, which
  // is the only handle this flow has for "the sessions this test just made".
  const first = `Workspace View One ${project.id}`
  const second = `Workspace View Two ${project.id}`
  await createSession(request, project.id, first)
  await createSession(request, project.id, second)

  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  await page.getByRole("button", { name: "Views: Create and manage multi-session views", exact: true }).click()
  await page.getByRole("button", { name: "Create view", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search available sessions" }).fill(project.id)
  for (const title of [first, second]) {
    const checkbox = page.getByRole("checkbox", { name: title })
    await checkbox.press("Space")
    await expect(checkbox).toBeChecked()
  }
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(`Workspace View ${suffix}`)
  await page.getByRole("button", { name: "Create view", exact: true }).click()

  const panes = page.locator(".views-manager-content")
  await expect(panes).toBeVisible()
  await page.getByRole("button", { name: "Open side panel" }).click()
  const workspace = page.locator(".session-side-panel.open")
  await expect(workspace).toBeVisible()

  // The same control the session toolbar has, because it is the same panel.
  const shared = (await workspace.boundingBox())!.width
  await page.getByRole("button", { name: "Fullscreen workspace" }).click()
  await expect(panes).toBeHidden()
  // Polled: the width is a transition, so sampling on the click reads the old
  // value and the assertion would turn on timing rather than on behaviour.
  await expect.poll(async () => (await workspace.boundingBox())?.width ?? 0).toBeGreaterThan(shared)
  // The header stays above the fullscreen workspace - it holds the way back -
  // and the panel underneath it is genuinely full-height, not a strip.
  await expect(page.locator(".active-view-header")).toBeVisible()
  expect((await workspace.boundingBox())!.height).toBeGreaterThan(400)

  // Closing the workspace has to bring the panes back - a view with neither on
  // screen is the empty window the layout rules exist to prevent.
  await page.getByRole("button", { name: "Close side panel" }).click()
  await expect(panes).toBeVisible()
  await expect(page.locator(".session-side-panel.open")).toHaveCount(0)
})

async function createProject(request: APIRequestContext, suffix: string) {
  const response = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: `Workspace View Project ${suffix}`, directory: workspaceDirectory, folders: [workspaceDirectory] },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const project: { id: string } = await response.json()
  return project
}

async function createSession(request: APIRequestContext, projectID: string, title: string) {
  const response = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID, directory: workspaceDirectory, title },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const session: { id: string } = await response.json()
  return session
}
