import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import path from "node:path"
import { fixtureDirectory } from "./fixture-directory"

const backendURL = "http://127.0.0.1:4097"
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": fixtureDirectory,
}
/** Above the transcript's synchronous-mount threshold, so switching sessions
 * takes the deferred-mount path a real specialist transcript would. */
const messageCount = 24

async function seedMessages(request: APIRequestContext, sessionID: string, label: string) {
  for (let index = 0; index < messageCount; index += 1) {
    const response = await request.post(`${backendURL}/session/${sessionID}/message`, {
      headers,
      data: {
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        noReply: true,
        parts: [{ type: "text", text: `${label} step ${index + 1}: ${"specialist transcript content ".repeat(4)}` }],
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
}

/**
 * Regression for the team-strip freeze: opening one specialist and then another
 * locked the whole app. Every assertion after a click doubles as a
 * responsiveness probe - a frozen main thread answers nothing.
 */
test("switching between swarm specialists keeps the app responsive", async ({ page, request }, testInfo) => {
  const suffix = `${path.basename(fixtureDirectory)}-${testInfo.retry}`
  const rootTitle = `Swarm Root ${suffix}`

  const projectResponse = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: `Swarm Project ${suffix}`, directory: fixtureDirectory, folders: [fixtureDirectory] },
  })
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
  const project: { id: string } = await projectResponse.json()

  const swarmResponse = await request.post(`${backendURL}/experimental/opencodex/swarm`, {
    headers,
    data: {
      projectID: project.id,
      title: `Feature Team ${suffix}`,
      roles: [
        { name: "Orchestrator", instructions: "Coordinate." },
        { name: "Designer", instructions: "Design." },
        { name: "Senior Engineer", instructions: "Build." },
      ],
    },
  })
  expect(swarmResponse.ok(), await swarmResponse.text()).toBe(true)
  const swarm: { id: string } = await swarmResponse.json()

  const sessionResponse = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID: project.id, directory: fixtureDirectory, title: rootTitle },
  })
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  const root: { id: string } = await sessionResponse.json()

  // Designer gets one run; Senior Engineer gets three, the "4x engineers" shape
  // that puts a run picker in the member pane.
  for (const child of [
    { title: `Design pass ${suffix}`, role: "Designer" },
    { title: `Module A ${suffix}`, role: "Senior Engineer" },
    { title: `Module B ${suffix}`, role: "Senior Engineer" },
    { title: `Module C ${suffix}`, role: "Senior Engineer" },
  ]) {
    const created = await request.post(`${backendURL}/session`, {
      headers,
      data: {
        parentID: root.id,
        title: child.title,
        metadata: { opencodex: { swarmID: swarm.id, swarmRole: child.role } },
      },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const createdChild: { id: string } = await created.json()
    await seedMessages(request, createdChild.id, child.title)
  }
  await seedMessages(request, root.id, "Orchestrator")

  // Last, because posting a message records the model it ran on: the strip only
  // appears for a session whose model routes to the swarm facade.
  const patched = await request.patch(`${backendURL}/session/${root.id}`, {
    headers,
    data: { model: { id: swarm.id, providerID: "swarm" } },
  })
  expect(patched.ok(), await patched.text()).toBe(true)

  await page.goto("/")
  await page.locator(".session-link-shell", { hasText: rootTitle }).first().locator(".session-link").click()
  await expect(page.locator(".session-page")).toBeVisible()

  // Both specialists are attributed to the team, not the "Other agents" bucket.
  const strip = page.locator(".swarm-team-strip")
  await expect(strip.getByRole("button", { name: /Designer/ })).toBeVisible()
  await expect(strip.getByRole("button", { name: /Senior Engineer/ })).toBeVisible()
  await expect(strip.getByRole("button", { name: /Other agents/ })).toHaveCount(0)

  // Open one specialist, then another. The second click is what froze.
  await strip.getByRole("button", { name: /Designer/ }).click()
  await expect(page.locator(".swarm-member-pane")).toBeVisible()
  await expect(page.locator(".swarm-member-heading")).toContainText("Designer")
  // A specialist's transcript has to actually arrive. Reconciling the catalog
  // used to abort this load - swarm children are hidden from the catalog by
  // design - and nothing retried, so the pane stayed blank for good.
  await expect(page.locator(".swarm-member-pane .message").first()).toContainText(`Design pass ${suffix} step 1`)

  await strip.getByRole("button", { name: /Senior Engineer/ }).click()
  await expect(page.locator(".swarm-member-heading")).toContainText("Senior Engineer")
  // Three runs, so the pane offers a run picker. It keeps clear of the way back
  // even when the pane is narrow - a picker that cannot shrink ends up with the
  // button sitting on top of it.
  await expect(page.locator(".swarm-member-run-select")).toBeVisible()
  await expect(page.locator(".swarm-member-pane .message").first()).toContainText(`Module`)
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await memberHeaderGap(page), `run picker crowds the back button at ${width}px`).toBeGreaterThan(8)
  }
  await page.setViewportSize({ width: 1440, height: 960 })

  // Back and forth again - a switch must stay cheap however often it happens.
  await strip.getByRole("button", { name: /Designer/ }).click()
  await expect(page.locator(".swarm-member-heading")).toContainText("Designer")
  await strip.getByRole("button", { name: /Senior Engineer/ }).click()
  await expect(page.locator(".swarm-member-heading")).toContainText("Senior Engineer")

  await page.getByRole("button", { name: "Back to orchestrator" }).click()
  await expect(page.locator(".swarm-member-pane")).toHaveCount(0)

  // With the graph canvas mounted alongside, switching specialists still has to
  // stay responsive: the canvas re-derives its layout from the same graph memo.
  await openGraphTab(page)
  await expect(page.locator(".session-graph-canvas")).toBeVisible()
  await strip.getByRole("button", { name: /Designer/ }).click()
  await expect(page.locator(".swarm-member-heading")).toContainText("Designer")
  await strip.getByRole("button", { name: /Senior Engineer/ }).click()
  await expect(page.locator(".swarm-member-heading")).toContainText("Senior Engineer")
  await expect(page.locator(".session-graph-canvas")).toBeVisible()

  // Locators time out on a frozen main thread, but they also pass on a thread
  // that is merely thrashing. Counting frames measures the thing the bug was
  // actually about: a frozen window paints none, a healthy one paints dozens.
  expect(await paintedFrames(page, 1000)).toBeGreaterThan(20)
})

/** Pixels between the run picker's right edge and the "back" button. */
async function memberHeaderGap(page: Page) {
  return page.locator(".swarm-member-header").evaluate((header) => {
    const select = header.querySelector(".swarm-member-run-select")?.getBoundingClientRect()
    const button = [...header.querySelectorAll("button")].at(-1)?.getBoundingClientRect()
    return select && button ? Math.round(button.left - select.right) : -1
  })
}

/** How many frames the page manages to paint in `ms`. */
async function paintedFrames(page: Page, ms: number) {
  return page.evaluate(
    (duration) =>
      new Promise<number>((resolve) => {
        let count = 0
        const end = performance.now() + duration
        const tick = () => {
          count += 1
          if (performance.now() < end) requestAnimationFrame(tick)
          else resolve(count)
        }
        requestAnimationFrame(tick)
      }),
    ms,
  )
}

/** The graph is a launcher card in the workspace fly-out, beside Git. */
async function openGraphTab(page: Page) {
  const panel = page.locator(".session-side-panel.open")
  if ((await panel.count()) === 0) await page.getByRole("button", { name: "Open side panel" }).click()
  await expect(panel).toBeVisible()
  const card = page.locator('.session-open-empty-actions button[data-empty-tone="graph"]')
  if ((await card.count()) > 0) {
    await card.click()
    return
  }
  await page.getByRole("button", { name: "New tab" }).click()
  await page.getByRole("button", { name: "Graph", exact: true }).click()
}
