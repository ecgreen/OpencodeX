import { expect, test, type APIRequestContext, type Locator } from "@playwright/test"
import path from "node:path"

const backendURL = "http://127.0.0.1:4097"
const messageCount = 200
const workspaceDirectory = path.resolve(import.meta.dirname, "../../..")
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": workspaceDirectory,
}

test("keeps sibling view transcript scroll independent while loading older messages", async ({ page, request }) => {
  test.setTimeout(90_000)
  const project = await createProject(request)
  const firstTitle = `Scroll Isolation One ${project.id}`
  const secondTitle = `Scroll Isolation Two ${project.id}`
  const firstSession = await createSession(request, project.id, firstTitle)
  const secondSession = await createSession(request, project.id, secondTitle)
  await Promise.all([seedMessages(request, firstSession.id), seedMessages(request, secondSession.id)])

  await page.goto("/")
  await expect(page.locator(".dashboard-page:not(.app-loading-skeleton)")).toBeVisible()
  await page.getByRole("button", { name: "Views: Create and manage multi-session views", exact: true }).click()
  await page.getByRole("button", { name: "Create view", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search available sessions" }).fill(project.id)
  const firstCheckbox = page.getByRole("checkbox", { name: firstTitle })
  const secondCheckbox = page.getByRole("checkbox", { name: secondTitle })
  await firstCheckbox.press("Space")
  await expect(firstCheckbox).toBeChecked()
  await secondCheckbox.press("Space")
  await expect(secondCheckbox).toBeChecked()
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Scroll Isolation View")
  await page.getByRole("button", { name: "Create view", exact: true }).click()

  const first = page.locator(`[data-session-id="${firstSession.id}"] .transcript`)
  const second = page.locator(`[data-session-id="${secondSession.id}"] .transcript`)
  await expect(first.getByRole("button", { name: "Load more", exact: true })).toBeVisible()
  await expect(second.getByRole("button", { name: "Load more", exact: true })).toBeVisible()
  const firstNode = await first.elementHandle()
  if (!firstNode) throw new Error("First transcript was not mounted.")

  const firstInitialHeight = (await scrollMetrics(first)).scrollHeight
  await first.getByRole("button", { name: "Load more", exact: true }).click()
  await expect.poll(async () => (await scrollMetrics(first)).scrollHeight).toBeGreaterThan(firstInitialHeight)
  await expect(first.getByRole("button", { name: "Load more", exact: true })).toBeVisible()
  await settleLayout(first)
  const before = await scrollMetrics(first)
  const beforePlacement = await viewPlacement(page.locator(".views-page"), first)
  const beforeAnchor = await first.getByRole("button", { name: "Load more", exact: true }).boundingBox()
  await first.evaluate((element) => {
    element.dataset.isolationScrollEvents = ""
    element.addEventListener("scroll", () => {
      element.dataset.isolationScrollEvents = [element.dataset.isolationScrollEvents, String(element.scrollTop)]
        .filter(Boolean)
        .join(",")
    })
  })

  const secondInitialHeight = (await scrollMetrics(second)).scrollHeight
  await second.getByRole("button", { name: "Load more", exact: true }).click()
  await expect.poll(async () => (await scrollMetrics(second)).scrollHeight).toBeGreaterThan(secondInitialHeight)
  await expect(second.getByRole("button", { name: "Load more", exact: true })).toBeVisible()
  await page.waitForTimeout(800)

  expect(await firstNode.evaluate((element) => element.isConnected)).toBe(true)
  expect(await scrollMetrics(first)).toEqual(before)
  expect(await viewPlacement(page.locator(".views-page"), first)).toEqual(beforePlacement)
  expect(await first.getByRole("button", { name: "Load more", exact: true }).boundingBox()).toEqual(beforeAnchor)
  expect(await first.getAttribute("data-isolation-scroll-events")).toBe("")
})

async function createProject(request: APIRequestContext) {
  const response = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: "Scroll Isolation", directory: workspaceDirectory, folders: [workspaceDirectory] },
  })
  expect(response.ok(), await response.text()).toBe(true)
  return response.json() as Promise<{ id: string }>
}

async function createSession(request: APIRequestContext, projectID: string, title: string) {
  const response = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID, directory: workspaceDirectory, title },
  })
  expect(response.ok(), await response.text()).toBe(true)
  return response.json() as Promise<{ id: string }>
}

async function seedMessages(request: APIRequestContext, sessionID: string) {
  for (let index = 0; index < messageCount; index += 1) {
    const response = await request.post(`${backendURL}/session/${sessionID}/message`, {
      headers,
      data: {
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        noReply: true,
        parts: [{ type: "text", text: `Message ${index + 1}: ${"independent transcript content ".repeat(5)}` }],
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const response = await request.get(`${backendURL}/session/${sessionID}/message?limit=${messageCount}`, { headers })
  expect(response.ok(), await response.text()).toBe(true)
  expect(await response.json()).toHaveLength(messageCount)
}

function scrollMetrics(transcript: Locator) {
  return transcript.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
}

function settleLayout(transcript: Locator) {
  return transcript.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

async function viewPlacement(view: Locator, transcript: Locator) {
  const bounds = await transcript.boundingBox()
  return {
    scrollTop: await view.evaluate((element) => element.scrollTop),
    transcriptTop: bounds?.y,
    transcriptLeft: bounds?.x,
  }
}
