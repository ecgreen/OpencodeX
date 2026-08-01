import { expect, test } from "@playwright/test"
import path from "node:path"
import { fixtureDirectory } from "./fixture-directory"

const backendURL = "http://127.0.0.1:4097"
/** Merge nodes carry "into <parent title>", so titles alone are ambiguous. */
const SESSION_NODE = '.session-graph-node[data-graph-kind="session"]'
const headers = {
  authorization: "Basic b3BlbmNvZGU6b3BlbmNvZGV4LWUyZQ==",
  "x-opencode-directory": fixtureDirectory,
}

/**
 * Regression for the node-click freeze: clicking a graph node once locked the
 * whole app in a synchronous reactive loop. Every assertion after a click
 * doubles as a responsiveness probe - a frozen main thread answers nothing.
 */
test("opening the graph and clicking nodes keeps the app responsive", async ({ page, request }, testInfo) => {
  const suffix = `${path.basename(fixtureDirectory)}-${testInfo.retry}`
  const rootTitle = `Graph Root ${suffix}`

  const projectResponse = await request.post(`${backendURL}/experimental/opencodex/project`, {
    headers,
    data: { name: `Graph Project ${suffix}`, directory: fixtureDirectory, folders: [fixtureDirectory] },
  })
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
  const project = (await projectResponse.json()) as { id: string }
  const sessionResponse = await request.post(`${backendURL}/experimental/opencodex/session`, {
    headers,
    data: { projectID: project.id, directory: fixtureDirectory, title: rootTitle },
  })
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  const root = (await sessionResponse.json()) as { id: string }

  // A delegation tree: two ordinary children, and one child tagged the way
  // swarm delegations are - which the session catalog deliberately hides, so
  // its node proves the graph's own children fetch works end to end.
  const childIDs: string[] = []
  for (const child of [
    { title: `Graph Child A ${suffix}` },
    { title: `Graph Child B ${suffix}` },
    { title: `Graph Hidden ${suffix}`, metadata: { opencodex: { swarmID: `swm-${suffix}` } } },
  ]) {
    const created = await request.post(`${backendURL}/session`, {
      headers,
      data: { parentID: root.id, ...child },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const childID = ((await created.json()) as { id: string }).id
    childIDs.push(childID)
    const posted = await request.post(`${backendURL}/session/${childID}/message`, {
      headers,
      data: {
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        noReply: true,
        parts: [{ type: "text", text: `Delegated work for ${child.title}.` }],
      },
    })
    expect(posted.ok(), await posted.text()).toBe(true)
  }
  // A second layer, the shape a hand-off produces, with nothing said in it yet.
  const grandchild = await request.post(`${backendURL}/session`, {
    headers,
    data: {
      parentID: childIDs[0],
      title: `Graph Grandchild ${suffix}`,
      metadata: { opencodex: { swarmID: `swm-${suffix}`, swarmDepth: 2 } },
    },
  })
  expect(grandchild.ok(), await grandchild.text()).toBe(true)

  await page.goto("/")
  await page.locator(".session-link-shell", { hasText: rootTitle }).first().locator(".session-link").click()
  await expect(page.locator(".session-page")).toBeVisible()

  // The graph is always one toolbar click away, whatever shape the tree is in.
  await page.getByRole("button", { name: "View workflow graph" }).click()
  await expect(page.locator(".session-graph-canvas")).toBeVisible()

  // Every step renders - including the catalog-hidden swarm child and the
  // second-layer hand-off - plus a merge per delegating layer, and the markers.
  await expect(page.locator('.session-graph-node[data-graph-kind="session"]')).toHaveCount(5)
  await expect(page.locator(SESSION_NODE, { hasText: `Graph Hidden ${suffix}` })).toBeVisible()
  await expect(page.locator('.session-graph-node[data-graph-kind="join"]')).toHaveCount(2)
  expect(await page.locator(".session-graph-edge-marker").count()).toBeGreaterThan(0)

  // An edge marker's tooltip needs a background of its own: the token behind it
  // was misnamed upstream, which left every tooltip in the app transparent and
  // unreadable over the canvas.
  await page.locator(".session-graph-edge-marker").first().hover()
  const tooltip = page.locator(".ui-tooltip").first()
  await expect(tooltip).toBeVisible()
  expect(await tooltip.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)")
  // Move off the marker so the open tooltip is not floating over what the rest
  // of this test needs to click.
  await page.mouse.move(0, 0)
  await expect(page.locator(".ui-tooltip")).toHaveCount(0)

  // Click a node at default zoom: the embedded transcript replaces the top
  // session's, and the way back works.
  await page.locator(SESSION_NODE, { hasText: `Graph Child A ${suffix}` }).click()
  await expect(page.locator(".session-graph-embedded")).toBeVisible()
  await expect(page.locator(".session-graph-embedded-heading")).toContainText(`Graph Child A ${suffix}`)
  await page.getByRole("button", { name: "Back to top session" }).click()
  await expect(page.locator(".session-graph-embedded")).toHaveCount(0)

  // The old freeze precondition: zoom until a node card is wider than the
  // pane, then select a node so the canvas has to reveal it. The canvas opens
  // fitted (well under 100%), so enough steps are needed to reach the 250%
  // clamp from any starting scale the fit can produce. dispatchEvent sidesteps
  // hit-testing, which cannot reach an off-viewport card, while still running
  // the exact click handler and reactive cascade.
  for (let step = 0; step < 14; step += 1) await page.getByRole("button", { name: "Zoom in" }).click()
  await expect(page.locator(".session-graph-zoom-value")).toHaveText("250%")
  await page.locator(SESSION_NODE, { hasText: `Graph Child B ${suffix}` }).dispatchEvent("click")
  await expect(page.locator(".session-graph-embedded")).toBeVisible()
  await expect(page.locator(".session-graph-embedded-heading")).toContainText(`Graph Child B ${suffix}`)

  // The hidden swarm child opens too - its transcript hydrates even though
  // the catalog does not carry it.
  await page.locator(SESSION_NODE, { hasText: `Graph Hidden ${suffix}` }).dispatchEvent("click")
  await expect(page.locator(".session-graph-embedded-heading")).toContainText(`Graph Hidden ${suffix}`)
  // Its transcript has to actually arrive, not just its header: a node that
  // opens to an empty pane tells the reader nothing about what the step did.
  await expect(page.locator(".session-graph-embedded .message").first()).toContainText(
    `Delegated work for Graph Hidden ${suffix}`,
  )

  // A step that has genuinely said nothing says so, rather than showing a pane
  // that is indistinguishable from a failed load.
  await page.locator(SESSION_NODE, { hasText: `Graph Grandchild ${suffix}` }).dispatchEvent("click")
  await expect(page.locator(".session-graph-embedded-heading")).toContainText(`Graph Grandchild ${suffix}`)
  await expect(page.locator(".embedded-session-status")).toContainText("has not produced any messages")

  // Escape returns to the top session; the graph canvas is still alive.
  await page.keyboard.press("Escape")
  await expect(page.locator(".session-graph-embedded")).toHaveCount(0)
  await page.getByRole("button", { name: "Fit graph to view" }).click()
  await expect(page.locator(".session-graph-zoom-value")).not.toHaveText("250%")

  // Last, because it navigates away: "open as a full session" has to actually
  // leave the embedded pane behind. It used to route underneath a pane that
  // survived the change, so the button read as doing nothing at all.
  await page.locator(SESSION_NODE, { hasText: `Graph Child A ${suffix}` }).click()
  await expect(page.locator(".session-graph-embedded")).toBeVisible()
  await page.getByRole("button", { name: "Open this step as a full session" }).click()
  await expect(page.locator(".session-graph-embedded")).toHaveCount(0)
  await expect(page.locator(".session-toolbar h1")).toContainText(`Graph Child A ${suffix}`)
})
