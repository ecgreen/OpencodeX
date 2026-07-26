import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import path from "node:path"
import { fixtureDirectory } from "./fixture-directory"

const backendURL = "http://127.0.0.1:4097"
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": fixtureDirectory,
}

test("completes project, session, swarm, view, menu, and keyboard workflows", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000)
  const projectName = `GUI Acceptance ${path.basename(fixtureDirectory)}-${testInfo.retry}`
  const failures: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text())
  })
  page.on("pageerror", (error) => failures.push(error.message))

  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()

  const project = await createProject(request, projectName)
  await expect(page.getByRole("button", { name: projectName, exact: true })).toBeVisible()
  await createSession(request, project.id)
  await createSession(request, project.id, "GUI Acceptance Companion")
  await expect(page.getByRole("button", { name: /GUI Acceptance Session/ }).first()).toBeVisible()

  await page.getByRole("button", { name: "Projects: Manage project groups and folders", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search projects or folders" }).fill(projectName)
  await page.locator(".project-directory-row", { hasText: projectName }).locator(".project-directory-open").click()
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible()
  await page.getByRole("button", { name: "New session", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Message OpencodeX..." })).toBeFocused()
  await page.getByTitle("Choose model").click()
  await expect(page.locator(".model-picker-modal")).toBeVisible()
  await expect(page.locator('.model-picker-section-toggle[aria-expanded="true"]')).toHaveCount(0)
  // Searching auto-expands the leading sections, but an explicit collapse has to
  // survive it: the toggle used to be overruled while any query was present.
  const modelSearch = page.getByPlaceholder("Search models, providers, or swarms")
  await modelSearch.fill("claude")
  const firstProviderToggle = page.locator(".model-picker-section-toggle").first()
  await expect(firstProviderToggle).toHaveAttribute("aria-expanded", "true")
  await firstProviderToggle.click()
  await expect(firstProviderToggle).toHaveAttribute("aria-expanded", "false")
  await modelSearch.fill("")
  const closeModelPicker = page.getByRole("button", { name: "Close Select model", exact: true })
  expect(await closeModelPicker.boundingBox()).toMatchObject({ width: 36, height: 36 })
  await closeModelPicker.click()

  await page.getByRole("button", { name: "Swarms: Create, manage, and run agent swarms", exact: true }).click()
  await page.getByRole("button", { name: "New swarm", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Create Swarm" })).toBeVisible()
  expect(await page.locator(".swarm-editor-page option").count()).toBeLessThan(100)
  // Models are an explicit choice per role: a fresh team reports what is
  // missing, saving stays disabled, and adding a preset selects it in the
  // roster so it can be configured immediately.
  await page.getByRole("button", { name: /^Product Manager/ }).click()
  expect(await page.locator(".swarm-editor-page option").count()).toBeLessThan(100)
  await expect(page.locator(".swarm-roster-row").nth(1)).toHaveClass(/selected/)
  await expect(page.locator(".swarm-editor-status")).toHaveText("0 of 2 roles have a model")
  await expect(page.getByRole("button", { name: "Create swarm", exact: true })).toBeDisabled()
  for (const roleIndex of [0, 1]) {
    await page.locator(".swarm-roster-row").nth(roleIndex).click()
    await page.locator(".swarm-model-button").click()
    await expect(page.locator(".model-picker-modal")).toBeVisible()
    await page.locator(".model-picker-section-toggle").first().click()
    await page.locator(".model-option-select").first().click()
    await expect(page.locator(".model-picker-modal")).toHaveCount(0)
  }
  await expect(page.locator(".swarm-editor-status")).toHaveCount(0)
  await page.getByRole("textbox", { name: "Name", exact: true }).first().fill("GUI Acceptance Swarm")
  await page.getByRole("button", { name: "Create swarm", exact: true }).click()
  // Creating lands back on the catalog; the new team is a card that opens the
  // editor (viewing and editing are the same page).
  const swarmCard = page.locator(".swarm-card", { hasText: "GUI Acceptance Swarm" })
  await expect(swarmCard).toBeVisible()
  await swarmCard.locator(".swarm-card-open").click()
  await expect(page.getByRole("heading", { name: "Edit Swarm" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Name", exact: true }).first()).toHaveValue("GUI Acceptance Swarm")
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible()
  await expect(page.locator(".swarm-roster-row")).toHaveCount(2)
  await page.locator(".swarm-editor-actions").getByRole("button", { name: "Close", exact: true }).click()
  // Swarms are models now: the picker's Swarms section lists the new team.
  await page.getByRole("button", { name: /GUI Acceptance Session/ }).first().click()
  await page.getByTitle("Choose model").click()
  await expect(page.locator(".swarm-option-card", { hasText: "GUI Acceptance Swarm" })).toBeVisible()
  await page.getByRole("button", { name: "Close Select model", exact: true }).click()

  await page.getByRole("button", { name: "Views: Create and manage multi-session views", exact: true }).click()
  await page.getByRole("button", { name: "Create view", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search available sessions" }).fill(path.basename(fixtureDirectory))
  const sessionCheckbox = page.getByRole("checkbox", { name: "GUI Acceptance Session" })
  const companionCheckbox = page.getByRole("checkbox", { name: "GUI Acceptance Companion" })
  await sessionCheckbox.press("Space")
  await expect(sessionCheckbox).toBeChecked()
  await companionCheckbox.press("Space")
  await expect(companionCheckbox).toBeChecked()
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("GUI Acceptance View")
  await page.getByRole("button", { name: "Create view", exact: true }).click()
  await expect(page.getByRole("heading", { name: "GUI Acceptance View" })).toBeVisible()
  await expect(page.getByText("2 panes - idle", { exact: true })).toBeVisible()
  const panes = page.locator(".view-pane")
  const firstTranscript = await panes.first().locator(".transcript").elementHandle()
  await panes.nth(1).click()
  await expect(panes.nth(1)).toHaveClass(/focused/)
  await page.waitForTimeout(500)
  expect(await firstTranscript?.evaluate((element) => element.isConnected)).toBe(true)

  await page.keyboard.press("Control+P")
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible()
  const paletteSearch = page.getByRole("searchbox", { name: "Search commands, sessions, projects, and views" })
  await paletteSearch.fill("operations dashboard")
  await expect(page.getByText("Open operations dashboard", { exact: true })).toBeVisible()
  await paletteSearch.fill("plugins")
  await page.getByRole("option", { name: "Plugins", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Plugin Center" })).toBeVisible()

  await openTitlebarMenu(page, "Help")
  await page.getByRole("menuitem").filter({ hasText: "Keyboard Shortcuts" }).click()
  await expect(page.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeVisible()
  await page.getByRole("button", { name: "Close keyboard help" }).click()

  await openTitlebarMenu(page, "File")
  await page.getByRole("menuitem", { name: "New Project", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("Folder selection is available in the OpencodeX desktop app.")
  await page.getByRole("button", { name: "Dismiss notification" }).click()
  await expect(page.getByRole("status")).toHaveCount(0)

  expect(failures).toEqual([])
})

async function createProject(request: APIRequestContext, name: string) {
  const response = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: {
      name,
      directory: fixtureDirectory,
      folders: [fixtureDirectory],
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const project: unknown = await response.json()
  if (!project || typeof project !== "object" || !("id" in project) || typeof project.id !== "string")
    throw new Error("Project creation response did not include an id.")
  return { id: project.id }
}

async function createSession(request: APIRequestContext, projectID: string, title = "GUI Acceptance Session") {
  const response = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: {
      projectID,
      directory: fixtureDirectory,
      title,
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function openTitlebarMenu(page: Page, label: string) {
  const trigger = page.getByRole("button", { name: label, exact: true })
  await trigger.focus()
  await trigger.press("Enter")
  await expect(page.locator('[data-component="menu-v2-content"]')).toBeVisible()
}
