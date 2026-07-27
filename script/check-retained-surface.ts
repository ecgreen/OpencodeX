#!/usr/bin/env bun

import path from "node:path"
import { stat } from "node:fs/promises"

const root = path.resolve(import.meta.dirname, "..")
const policy = (await Bun.file(path.join(root, "upstream/policy.json")).json()) as {
  retainedWorkspaces: { path: string; name: string }[]
  permanentlyPrunedPaths: string[]
  ownedConfiguration: string[]
  forbiddenOwnedConfigurationText: string[]
}
const manifest = (await Bun.file(path.join(root, "package.json")).json()) as {
  workspaces: { packages: string[]; catalog: Record<string, string> }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  overrides?: Record<string, string>
  patchedDependencies?: Record<string, string>
}
const errors: string[] = []
const retainedNames = new Set(policy.retainedWorkspaces.map((workspace) => workspace.name))
const catalogReferences = new Set<string>()

for (const pruned of policy.permanentlyPrunedPaths) {
  if (await exists(path.join(root, pruned))) errors.push(`pruned path returned: ${pruned}`)
}

for (const workspace of policy.retainedWorkspaces) {
  const file = Bun.file(path.join(root, workspace.path, "package.json"))
  if (!(await file.exists())) {
    errors.push(`retained workspace is missing: ${workspace.path}`)
    continue
  }
  const packageManifest = (await file.json()) as {
    name?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  if (packageManifest.name !== workspace.name) {
    errors.push(`retained workspace name mismatch: ${workspace.path} is ${packageManifest.name ?? "unnamed"}`)
  }
  for (const dependencies of [
    packageManifest.dependencies,
    packageManifest.devDependencies,
    packageManifest.peerDependencies,
    packageManifest.optionalDependencies,
  ]) {
    for (const [name, version] of Object.entries(dependencies ?? {})) {
      if (version.startsWith("workspace:") && !retainedNames.has(name)) {
        errors.push(`${workspace.path} references removed workspace ${name}`)
      }
      if (version.startsWith("catalog:")) catalogReferences.add(name)
    }
  }
}

const configuredWorkspaces = new Set(manifest.workspaces.packages)
for (const workspace of policy.retainedWorkspaces) {
  if (!configuredWorkspaces.has(workspace.path)) errors.push(`root workspaces omit ${workspace.path}`)
}
for (const configured of configuredWorkspaces) {
  if (!policy.retainedWorkspaces.some((workspace) => workspace.path === configured)) {
    errors.push(`root workspaces include undeclared path ${configured}`)
  }
}

for (const dependencies of [manifest.dependencies, manifest.devDependencies, manifest.overrides]) {
  for (const [name, version] of Object.entries(dependencies ?? {})) {
    if (version.startsWith("catalog:")) catalogReferences.add(name)
    if (version.startsWith("workspace:") && !retainedNames.has(name))
      errors.push(`root references removed workspace ${name}`)
  }
}
for (const name of catalogReferences) {
  if (!(name in manifest.workspaces.catalog)) errors.push(`catalog reference has no entry: ${name}`)
}
for (const name of Object.keys(manifest.workspaces.catalog)) {
  if (!catalogReferences.has(name)) errors.push(`orphaned catalog entry: ${name}`)
}

const referencedPatches = new Set(
  Object.values(manifest.patchedDependencies ?? {}).map((file) => file.replaceAll("\\", "/")),
)
for (const file of referencedPatches) {
  if (!(await Bun.file(path.join(root, file)).exists())) errors.push(`patched dependency file is missing: ${file}`)
}
for await (const file of new Bun.Glob("*.patch").scan({ cwd: path.join(root, "patches") })) {
  if (!referencedPatches.has(`patches/${file.replaceAll("\\", "/")}`))
    errors.push(`orphaned patch file: patches/${file}`)
}

for (const configured of policy.ownedConfiguration) {
  const absolute = path.join(root, configured)
  if (!(await exists(absolute))) continue
  const files = (await stat(absolute)).isDirectory()
    ? await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: absolute, onlyFiles: true }))
    : [""]
  for (const file of files) {
    const target = file ? path.join(absolute, file) : absolute
    const contents = await Bun.file(target)
      .text()
      .catch(() => "")
    for (const forbidden of policy.forbiddenOwnedConfigurationText) {
      if (contents.includes(forbidden))
        errors.push(`forbidden upstream-owned reference ${JSON.stringify(forbidden)} in ${path.relative(root, target)}`)
    }
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"))
  process.exit(1)
}
console.log(`retained surface is clean (${policy.retainedWorkspaces.length} workspaces)`)

async function exists(file: string) {
  return stat(file)
    .then(() => true)
    .catch(() => false)
}
