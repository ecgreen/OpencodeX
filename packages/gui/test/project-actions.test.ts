import { describe, expect, test } from "bun:test"
import {
  newSessionDirectory,
  projectFolderValidationMessage,
  projectFoldersFromText,
  projectNameFromDirectory,
  runCreateProjectAction,
  runCreateSessionRouteAction,
  runDeleteProjectAction,
  runEditProjectAction,
  runEditProjectFoldersAction,
  runRenameProjectAction,
} from "../src/renderer/src/lib/project-actions"
import type { GuiSnapshot } from "../src/renderer/src/lib/store"

describe("GUI project action decisions", () => {
  test("derives project names from selected directories", () => {
    expect(projectNameFromDirectory("C:/Work/OpencodeX")).toBe("OpencodeX")
    expect(projectNameFromDirectory("C:\\Work\\ProjectUnify\\")).toBe("ProjectUnify")
    expect(projectNameFromDirectory("/")).toBe("New Project")
  })

  test("parses one project folder per line", () => {
    expect(projectFoldersFromText(" C:/Work/One \n\n C:/Work/Two\r\n")).toEqual(["C:/Work/One", "C:/Work/Two"])
  })

  test("formats validation messages from backend folder checks", () => {
    expect(projectFolderValidationMessage({ data: { valid: true, folders: [] } })).toBeUndefined()
    expect(projectFolderValidationMessage({ data: { valid: false, folders: [{ input: "C:/Nope", message: "Missing folder" }, { input: "C:/Bad" }] } })).toBe("Missing folder\nC:/Bad is invalid")
    expect(projectFolderValidationMessage({ data: { valid: false, folders: [] } })).toBe("Project folder validation failed.")
  })

  test("chooses a new-session directory from explicit input, first project, then GUI directory", () => {
    expect(newSessionDirectory({ directory: "C:/Explicit", projects: [project("C:/Project")], guiDirectory: "C:/Gui" })).toBe("C:/Explicit")
    expect(newSessionDirectory({ projects: [project("C:/Project")], guiDirectory: "C:/Gui" })).toBe("C:/Project")
    expect(newSessionDirectory({ projects: [], guiDirectory: "C:/Gui" })).toBe("C:/Gui")
    expect(newSessionDirectory({ projects: [], guiDirectory: "" })).toBeUndefined()
  })

  test("creates projects through folder choice, validation, backend create, and refresh", async () => {
    const calls: string[] = []

    await runCreateProjectAction({
      fallbackDirectory: "C:/Work",
      chooseFolder: async (fallback) => {
        calls.push(`choose:${fallback}`)
        return "C:/Work/OpencodeX"
      },
      validateProjectFolders: async (folders) => {
        calls.push(`validate:${folders.join(",")}`)
        return { data: { valid: true, folders: [] } }
      },
      createProject: async (name, directory) => calls.push(`create:${name}:${directory}`),
      refresh: async () => calls.push("refresh"),
      alert: (message) => calls.push(`alert:${message}`),
    })

    expect(calls).toEqual([
      "choose:C:/Work",
      "validate:C:/Work/OpencodeX",
      "create:OpencodeX:C:/Work/OpencodeX",
      "refresh",
    ])
  })

  test("stops project creation when validation fails", async () => {
    const calls: string[] = []

    await runCreateProjectAction({
      fallbackDirectory: "",
      chooseFolder: async (fallback) => {
        calls.push(`choose:${fallback}`)
        return "C:/Missing"
      },
      validateProjectFolders: async () => ({ data: { valid: false, folders: [{ input: "C:/Missing", message: "Folder is missing" }] } }),
      createProject: async () => calls.push("create"),
      refresh: async () => calls.push("refresh"),
      alert: (message) => calls.push(`alert:${message}`),
    })

    expect(calls).toEqual(["choose:.", "alert:Folder is missing"])
  })

  test("stops project creation when folder selection is cancelled", async () => {
    const calls: string[] = []

    await runCreateProjectAction({
      fallbackDirectory: "C:/Work",
      chooseFolder: async (fallback) => {
        calls.push(`choose:${fallback}`)
        return undefined
      },
      validateProjectFolders: async () => {
        calls.push("validate")
        return { data: { valid: true, folders: [] } }
      },
      createProject: async () => calls.push("create"),
      refresh: async () => calls.push("refresh"),
      alert: (message) => calls.push(`alert:${message}`),
    })

    expect(calls).toEqual(["choose:C:/Work"])
  })

  test("renames projects only when the entered name is non-empty", async () => {
    const calls: string[] = []

    await runRenameProjectAction({
      projectID: "project-1",
      current: "Old",
      askText: async () => "  New  ",
      renameProject: async (projectID, name) => calls.push(`rename:${projectID}:${name}`),
      refresh: async () => calls.push("refresh"),
    })
    await runRenameProjectAction({
      projectID: "project-2",
      askText: async () => "   ",
      renameProject: async () => calls.push("rename-empty"),
      refresh: async () => calls.push("refresh-empty"),
    })

    expect(calls).toEqual(["rename:project-1:New", "refresh"])
  })

  test("edits project folders through text parsing, validation, backend update, and refresh", async () => {
    const calls: string[] = []

    await runEditProjectFoldersAction({
      projectID: "project-1",
      folders: ["C:/Old"],
      askText: async () => "C:/One\n\n C:/Two ",
      validateProjectFolders: async (projectID, folders) => {
        calls.push(`validate:${projectID}:${folders.join("|")}`)
        return { data: { valid: true, folders: [] } }
      },
      updateProjectFolders: async (projectID, folders) => calls.push(`update:${projectID}:${folders.join("|")}`),
      refresh: async () => calls.push("refresh"),
      alert: (message) => calls.push(`alert:${message}`),
    })

    expect(calls).toEqual([
      "validate:project-1:C:/One|C:/Two",
      "update:project-1:C:/One|C:/Two",
      "refresh",
    ])
  })

  test("edits project name and folders together after validation", async () => {
    const calls: string[] = []
    const answers = ["  New Name  ", "C:/One\n\n C:/Two "]

    await runEditProjectAction({
      projectID: "project-1",
      currentName: "Old",
      folders: ["C:/Old"],
      askText: async (input) => {
        calls.push(`ask:${input.title}:${input.value}`)
        return answers.shift()
      },
      validateProjectFolders: async (projectID, folders) => {
        calls.push(`validate:${projectID}:${folders.join("|")}`)
        return { data: { valid: true, folders: [] } }
      },
      updateProject: async (projectID, next) => calls.push(`update:${projectID}:${next.name}:${next.folders.join("|")}`),
      refresh: async () => calls.push("refresh"),
      alert: (message) => calls.push(`alert:${message}`),
    })

    expect(calls).toEqual([
      "ask:Edit Project Name:Old",
      "ask:Edit Project Folders:C:/Old",
      "validate:project-1:C:/One|C:/Two",
      "update:project-1:New Name:C:/One|C:/Two",
      "refresh",
    ])
  })

  test("does not update project details when folder validation fails", async () => {
    const calls: string[] = []
    const answers = ["New Name", "C:/Missing"]

    await runEditProjectAction({
      projectID: "project-1",
      currentName: "Old",
      folders: ["C:/Old"],
      askText: async () => answers.shift(),
      validateProjectFolders: async () => ({ data: { valid: false, folders: [{ input: "C:/Missing", message: "Missing folder" }] } }),
      updateProject: async () => calls.push("update"),
      refresh: async () => calls.push("refresh"),
      alert: (message) => calls.push(`alert:${message}`),
    })

    expect(calls).toEqual(["alert:Missing folder"])
  })

  test("deletes projects only after confirmation", async () => {
    const calls: string[] = []

    await runDeleteProjectAction({
      projectID: "project-1",
      name: "Project",
      confirm: async () => false,
      deleteProject: async () => calls.push("delete-cancelled"),
      refresh: async () => calls.push("refresh-cancelled"),
    })
    await runDeleteProjectAction({
      projectID: "project-1",
      name: "Project",
      confirm: async () => true,
      deleteProject: async (projectID) => calls.push(`delete:${projectID}`),
      refresh: async () => calls.push("refresh"),
    })

    expect(calls).toEqual(["delete:project-1", "refresh"])
  })

  test("routes new session creation and focuses the composer", () => {
    const calls: string[] = []

    runCreateSessionRouteAction({
      projectID: "project-1",
      projects: [project("C:/Project")],
      guiDirectory: "C:/Gui",
      setPrompt: (value) => calls.push(`prompt:${value}`),
      openNewSession: (projectID, directory) => calls.push(`route:${projectID}:${directory}`),
      focusComposer: () => calls.push("focus"),
    })
    runCreateSessionRouteAction({
      projects: [],
      guiDirectory: "",
      setPrompt: () => calls.push("prompt-empty"),
      openNewSession: () => calls.push("route-empty"),
      focusComposer: () => calls.push("focus-empty"),
    })

    expect(calls).toEqual(["prompt:", "route:project-1:C:/Project", "focus"])
  })
})

function project(folder: string): GuiSnapshot["projects"][number] {
  return {
    id: "project-1",
    name: "Project",
    project: { id: "project-core", name: "Project", time: { created: 1, updated: 1 } },
    folders: [{ path: folder }],
    sessions: [],
  }
}
