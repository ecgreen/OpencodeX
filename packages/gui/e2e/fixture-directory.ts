import { mkdtempSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export const fixtureDirectory = mkdtempSync(path.join(os.tmpdir(), "opencodex-gui-e2e-"))
