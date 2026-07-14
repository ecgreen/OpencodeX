import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

const backendURL = "http://127.0.0.1:4097"
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": "C:/Work/OpencodeX",
}

test("completes project, session, swarm, view, workbench, menu, and keyboard workflows", async ({
  page,
  request,
}) => {
  const failures: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text())
  })
  page.on("pageerror", (error) => failures.push(error.message))

  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()

  const project = await createProject(request)
  await expect(page.getByRole("button", { name: "GUI Acceptance", exact: true })).toBeVisible()
  await createSession(request, project.id)
  await expect(page.getByRole("button", { name: /GUI Acceptance Session .*ready for review/ }).first()).toBeVisible()

  await page.getByRole("button", { name: /GUI Acceptance 1 sessions/ }).click()
  await expect(page.getByRole("heading", { name: "GUI Acceptance" })).toBeVisible()
  await page.getByRole("button", { name: "New session", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Message OpencodeX..." })).toBeFocused()

  await page.getByRole("button", { name: "Swarms: Create, manage, and run agent swarms", exact: true }).click()
  await page.getByRole("button", { name: "Create", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Create swarm" })).toBeVisible()
  expect(await page.locator(".swarm-editor-page option").count()).toBeLessThan(100)
  await page.getByRole("button", { name: "Add role", exact: true }).click()
  expect(await page.locator(".swarm-editor-page option").count()).toBeLessThan(100)
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("GUI Acceptance Swarm")
  await page.getByRole("button", { name: "Create swarm", exact: true }).click()
  await expect(page.getByRole("heading", { name: "GUI Acceptance Swarm" })).toBeVisible()
  await expect(page.getByText(/2 roles - 0 tasks/)).toBeVisible()

  await page.getByRole("button", { name: "Views: Create and manage multi-session views", exact: true }).click()
  await page.getByRole("button", { name: "Create view", exact: true }).click()
  await page.getByRole("checkbox", { name: /GUI Acceptance Session/ }).check()
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("GUI Acceptance View")
  await page.getByRole("button", { name: "Create view", exact: true }).click()
  await expect(page.getByRole("heading", { name: "GUI Acceptance View" })).toBeVisible()
  await expect(page.getByText("1 panes - idle", { exact: true })).toBeVisible()

  await openTitlebarMenu(page, "View")
  await page.getByRole("button", { name: "Browser / Workbench", exact: true }).click()
  await expect(page.getByRole("navigation", { name: "Workbench tabs" })).toBeVisible()
  await expect(page.getByText("Project checks run on demand.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Run project checks" })).toBeEnabled()
  await page.getByRole("treeitem", { name: "AGENTS.md", exact: true }).click()
  await expect(page.getByRole("tab", { name: "AGENTS.md", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("button", { name: "Git", exact: true }).click()
  await expect(page.getByRole("listbox", { name: "Changed files" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Clear changed file filter" })).toBeDisabled()

  await page.keyboard.press("Control+P")
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible()
  await page.getByPlaceholder("Search commands").fill("operations dashboard")
  await expect(page.getByText("Open operations dashboard", { exact: true })).toBeVisible()
  await page.getByPlaceholder("Search commands").fill("plugins")
  await page.getByRole("option", { name: "Plugins", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Plugin Center" })).toBeVisible()

  await openTitlebarMenu(page, "Help")
  await page.getByRole("button", { name: "Keyboard Shortcuts", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeVisible()
  await page.getByRole("button", { name: "Close keyboard help" }).click()

  await openTitlebarMenu(page, "File")
  await page.getByRole("button", { name: "New Project", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("Folder selection is available in the OpencodeX desktop app.")
  await page.getByRole("button", { name: "Dismiss notification" }).click()
  await expect(page.getByRole("status")).toHaveCount(0)

  expect(failures).toEqual([])
})

async function createProject(request: APIRequestContext) {
  const response = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: {
      name: "GUI Acceptance",
      directory: "C:/Work/OpencodeX",
      folders: ["C:/Work/OpencodeX"],
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const project: unknown = await response.json()
  if (!project || typeof project !== "object" || !("id" in project) || typeof project.id !== "string")
    throw new Error("Project creation response did not include an id.")
  return { id: project.id }
}

async function createSession(request: APIRequestContext, projectID: string) {
  const response = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: {
      projectID,
      directory: "C:/Work/OpencodeX",
      title: "GUI Acceptance Session",
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function openTitlebarMenu(page: Page, label: string) {
  await page.locator(".titlebar-menu-group summary").filter({ hasText: label }).click()
}
