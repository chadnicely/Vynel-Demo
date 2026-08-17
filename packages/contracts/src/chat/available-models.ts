// The DISCOVERED model roster — what the user's engine actually supports,
// captured from the Agent SDK's session-initialize response on every turn
// (providers seam) and served by `GET /providers/:providerId/models`. The
// curated `chat-models.ts` list stays as the static FLOOR: what the picker
// shows before the engine has ever been asked. Grouping and context-window
// figures are derived HERE at read time (never stored), so a smarter resolver
// retrofits old rosters for free.

import { CHAT_MODELS } from './chat-models.js'
import { resolveContextWindow } from './model-context-window.js'
import type { ThinkingEffortLevel } from './thinking-effort.js'

/** One discovered model as persisted (the engine's answer, context-free). */
export interface DiscoveredChatModel {
  /** The canonical wire id (`claude-…`) — what a turn's `model` field takes. */
  id: string
  label: string
  description: string | null
  /** Effort levels the model supports — null when the engine didn't say. */
  supportedEffortLevels: ThinkingEffortLevel[] | null
}

/** One model as served to the picker — the stored shape plus derived figures. */
export interface AvailableChatModel extends DiscoveredChatModel {
  contextWindowTokens: number
}

export interface GroupedChatModels {
  /** The newest model of each family — the picker's primary list. */
  current: AvailableChatModel[]
  /** Older generations + unrecognized ids — behind the picker's "More". */
  more: AvailableChatModel[]
}

// Family order for the picker: capability tiers first (matches the floor list).
const FAMILY_ORDER = ['fable', 'mythos', 'opus', 'sonnet', 'haiku'] as const
type ClaudeModelFamily = (typeof FAMILY_ORDER)[number]

/** Parse `claude-opus-4-8` / `claude-3-5-sonnet-20241022` into family + an
 *  ORDERABLE version (major*100+minor: 4.8 → 408, 5 → 500 — encoding, not
 *  display, so 4.10 can never sort below 4.9). Version segments are the ≤2
 *  small numbers adjacent to the family token — an 8-digit date suffix is
 *  never a version. */
export function parseClaudeModelId(id: string): {
  family: ClaudeModelFamily | null
  version: number | null
} {
  const segments = id.toLowerCase().split('-')
  const familyIndex = segments.findIndex((segment) =>
    (FAMILY_ORDER as readonly string[]).includes(segment),
  )
  if (familyIndex === -1) return { family: null, version: null }
  const family = segments[familyIndex] as ClaudeModelFamily

  const isVersionSegment = (segment: string | undefined): segment is string =>
    segment !== undefined && /^\d{1,2}$/.test(segment)
  // Modern ids put the version after the family; 3.x ids put it before.
  let versionSegments = segments.slice(familyIndex + 1).filter(isVersionSegment)
  if (versionSegments.length === 0) {
    versionSegments = segments.slice(0, familyIndex).filter(isVersionSegment)
  }
  if (versionSegments.length === 0) return { family, version: null }
  const [major, minor] = versionSegments
  return { family, version: Number.parseInt(major!, 10) * 100 + Number.parseInt(minor ?? '0', 10) }
}

/** Split the roster: the newest model per family up front, everything else
 *  (older generations, unrecognized ids) behind "More". Both halves ordered
 *  by family tier, then version descending. */
export function groupAvailableModels(models: AvailableChatModel[]): GroupedChatModels {
  const parsed = models.map((model) => ({ model, ...parseClaudeModelId(model.id) }))

  const newestByFamily = new Map<ClaudeModelFamily, number>()
  for (const entry of parsed) {
    if (entry.family === null || entry.version === null) continue
    const known = newestByFamily.get(entry.family)
    if (known === undefined || entry.version > known) {
      newestByFamily.set(entry.family, entry.version)
    }
  }

  const tierOf = (family: ClaudeModelFamily | null): number =>
    family === null ? FAMILY_ORDER.length : FAMILY_ORDER.indexOf(family)
  const sorted = [...parsed].sort(
    (a, b) => tierOf(a.family) - tierOf(b.family) || (b.version ?? 0) - (a.version ?? 0),
  )

  const current: AvailableChatModel[] = []
  const more: AvailableChatModel[] = []
  // One current row per family: a version TIE (an alias id and a date-suffixed
  // id parsing to the same version) must not render two "current" rows — the
  // first in sort order wins, the twin drops to "more".
  const familiesTaken = new Set<ClaudeModelFamily>()
  for (const entry of sorted) {
    const isCurrent =
      entry.family !== null &&
      entry.version !== null &&
      newestByFamily.get(entry.family) === entry.version &&
      !familiesTaken.has(entry.family)
    if (isCurrent) familiesTaken.add(entry.family!)
    ;(isCurrent ? current : more).push(entry.model)
  }
  return { current, more }
}

/** The effort levels to OFFER for a model (2026-08-17). The engine reports
 *  what each model supports; until this was read, the picker offered all five
 *  for every model and the engine silently downgraded an unsupported pick —
 *  the chip said one thing and the turn did another. A model the engine said
 *  nothing about (`null`, and every row of the static floor) keeps the full
 *  set: never hide a level on a guess. Order follows the canonical options,
 *  not the engine's. */
export function selectEffortOptionsForModel<T extends { id: ThinkingEffortLevel }>(
  options: readonly T[],
  model: Pick<DiscoveredChatModel, 'supportedEffortLevels'> | undefined,
): T[] {
  const supported = model?.supportedEffortLevels ?? null
  if (supported === null || supported.length === 0) return [...options]
  const allowed = new Set<ThinkingEffortLevel>(supported)
  const filtered = options.filter((option) => allowed.has(option.id))
  // An engine answer that matches nothing we offer is a degraded answer, not a
  // reason to render an empty picker.
  return filtered.length > 0 ? filtered : [...options]
}

/** "1M" / "200K" — the picker's per-model context chip. */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`
  return `${Math.round(tokens / 1_000)}K`
}

/** The static floor as a roster — served until the engine has answered once. */
export function availableChatModelsFloor(): AvailableChatModel[] {
  return CHAT_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    description: null,
    supportedEffortLevels: null,
    contextWindowTokens: resolveContextWindow(model.id),
  }))
}

/** Derive the served shape from a stored roster. */
export function toAvailableChatModels(models: DiscoveredChatModel[]): AvailableChatModel[] {
  return models.map((model) => ({
    ...model,
    contextWindowTokens: resolveContextWindow(model.id),
  }))
}
