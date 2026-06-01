import { describe, expect, test } from "bun:test"
import { ProjectV2 } from "@opencode-ai/core/project"
import { OpencodeXProjectFolder } from "@/opencodex/project-folder"
import path from "path"

describe("OpencodeXProjectFolder", () => {
  test("matches the longest containing folder", () => {
    const projectID = ProjectV2.ID.make("project")
    const root = path.resolve("repo")
    const nested = path.join(root, "packages", "app")
    const target = path.join(nested, "src", "index.ts")

    expect(
      OpencodeXProjectFolder.matchFolder(
        [
          { path: root, opencodex_project_id: "opx_test", project_id: projectID, time_created: 1, time_updated: 1 },
          { path: nested, opencodex_project_id: "opx_test", project_id: projectID, time_created: 1, time_updated: 1 },
        ],
        target,
      )?.path,
    ).toBe(nested)
  })

  test("does not match sibling paths", () => {
    const projectID = ProjectV2.ID.make("project")
    const root = path.resolve("repo")

    expect(
      OpencodeXProjectFolder.matchFolder(
        [{ path: root, opencodex_project_id: "opx_test", project_id: projectID, time_created: 1, time_updated: 1 }],
        path.resolve("repo-other", "file.ts"),
      ),
    ).toBeUndefined()
  })
})
