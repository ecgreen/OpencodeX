import { ProviderV2 } from "@opencode-ai/core/provider"
import { ClaudeTransport, DEFAULT_MODEL_VALUE, EFFORT_LEVELS, type ClaudeModelInfo } from "@/opencodex/claude-transport"

/**
 * "Claude Subscription" is a first-class provider in OpencodeX even though it is
 * not an API provider: selecting one of its models routes the session's turns
 * through the user's locally installed Claude Code CLI, which carries its own
 * subscription auth. It is synthesized here (never from models.dev) so it
 * appears in the normal model picker alongside every other provider.
 *
 * `Provider.getLanguage` must never be called for these models - the session
 * loop branches to the Claude driver before any AI-SDK binding happens.
 */
export const CLAUDE_CODE_PROVIDER_ID = ProviderV2.ID.make("claude-code")
export const CLAUDE_CODE_DEFAULT_MODEL_ID = ProviderV2.ModelID.make(DEFAULT_MODEL_VALUE)

/**
 * Shown until the CLI has been asked what this account may actually use. Only
 * the tier aliases appear here because they are stable across CLI versions and
 * plans; the discovered menu replaces them wholesale.
 */
const FALLBACK_MODELS: ClaudeModelInfo[] = [
  { value: DEFAULT_MODEL_VALUE, displayName: "Default" },
  { value: "opus", displayName: "Opus", supportsEffort: true },
  { value: "sonnet", displayName: "Sonnet", supportsEffort: true },
  { value: "haiku", displayName: "Haiku" },
]

/** Spawning the CLI is expensive, and `Provider.list()` runs on every refresh. */
const DISCOVERY_TTL_MS = 5 * 60_000
/** A machine with no CLI should not re-probe on every refresh either. */
const FAILURE_TTL_MS = 60_000
const DISCOVERY_TIMEOUT_MS = 10_000
let discovered: { models: ClaudeModelInfo[]; at: number } | undefined
let attemptedAt = 0
let inFlight: Promise<ClaudeModelInfo[]> | undefined

export function isClaudeCodeProvider(providerID: string) {
  return providerID === CLAUDE_CODE_PROVIDER_ID
}

export function claudeCodeProviderInfo(models: ClaudeModelInfo[] = discovered?.models ?? FALLBACK_MODELS) {
  const rows = models.length > 0 ? models : FALLBACK_MODELS
  return {
    id: CLAUDE_CODE_PROVIDER_ID,
    source: "custom" as const,
    name: "Claude Subscription",
    env: [] as string[],
    // Auth lives in the Claude Code CLI, so nothing here is a credential; the
    // placeholder only marks the provider as usable without an API key.
    options: { apiKey: "local" } as Record<string, unknown>,
    models: Object.fromEntries(rows.map((model) => [model.value, claudeCodeModel(model)])),
  }
}

/**
 * Refreshes the model menu from the installed CLI, at most once per TTL and
 * never concurrently. Discovery failures are silent by design: a missing or
 * signed-out CLI still shows the fallback rows, and the resulting turn reports
 * the real error in the transcript.
 */
export async function refreshClaudeCodeModels(now = Date.now()) {
  const ttl = discovered ? DISCOVERY_TTL_MS : FAILURE_TTL_MS
  if (attemptedAt && now - attemptedAt < ttl) return discovered?.models ?? FALLBACK_MODELS
  attemptedAt = now
  inFlight ??= discoverModels().finally(() => {
    inFlight = undefined
  })
  await inFlight
  return discovered?.models ?? FALLBACK_MODELS
}

async function discoverModels() {
  const controller = new AbortController()
  // A CLI that never answers must not stall the capabilities snapshot behind it.
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    const models = await ClaudeTransport.listSupportedModels({ signal: controller.signal })
    if (models.length > 0) discovered = { models, at: Date.now() }
    return models
  } catch {
    return [] as ClaudeModelInfo[]
  } finally {
    clearTimeout(timer)
  }
}

/** Test seam: drops the cached menu so the next refresh re-discovers. */
export function resetClaudeCodeModels() {
  discovered = undefined
  attemptedAt = 0
  inFlight = undefined
}

/**
 * The CLI's `displayName` is a bare tier ("Opus", "Fable"), which leaves no way
 * to tell which generation is running. Its `description` leads with the versioned
 * name ("Fable 5 · Most capable ..."), so that is the better label.
 */
export function claudeCodeModelName(info: ClaudeModelInfo) {
  const lead = info.description?.split("·")[0]?.trim()
  // Only take it when it actually names a generation ("Fable 5"); a prose
  // description like "Most capable" is a worse label than the tier name.
  const versioned = lead && /\d/.test(lead) ? lead : undefined
  if (!versioned) return info.displayName || info.value
  return info.value === DEFAULT_MODEL_VALUE ? `Default (${versioned})` : versioned
}

/**
 * Effort maps onto OpencodeX variants, which is the same chip other reasoning
 * models use, so the composer control works without a Claude-specific surface.
 */
function claudeCodeVariants(info: ClaudeModelInfo) {
  if (info.supportsEffort !== true) return {}
  const levels = info.supportedEffortLevels?.length ? info.supportedEffortLevels : EFFORT_LEVELS
  return Object.fromEntries(levels.filter((level) => EFFORT_LEVELS.includes(level)).map((level) => [level, { effort: level }]))
}

function claudeCodeModel(info: ClaudeModelInfo) {
  return {
    id: ProviderV2.ModelID.make(info.value),
    providerID: CLAUDE_CODE_PROVIDER_ID,
    name: claudeCodeModelName(info),
    family: "claude",
    api: { id: info.value, url: "", npm: "" },
    status: "active" as const,
    headers: {} as Record<string, string>,
    options: {} as Record<string, unknown>,
    // Billing happens on the subscription, and Claude Code reports real spend
    // per turn, so the catalog carries no per-token pricing.
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    // Claude Code compacts its own context; OpencodeX-side compaction must not
    // fire for these sessions, so the window is stated generously.
    limit: { context: 1_000_000, output: 64_000 },
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: true,
    },
    release_date: "",
    variants: claudeCodeVariants(info) as Record<string, unknown>,
  }
}
