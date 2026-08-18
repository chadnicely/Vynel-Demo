// The chat models' STATIC FLOOR — what the picker shows before the engine has
// ever reported its real roster (see `available-models.ts` for the discovered
// side). The chosen id is passed to the Agent SDK's `options.model`; the model
// the session actually ran with is recorded on `chat_sessions.model` (drives
// the context-window denominator — see resolveContextWindow). Full ids, no
// date suffix, per the claude-api guidance.
//
// Since the roster went dynamic (2026-07-31) the route schemas validate SHAPE
// (`ChatModelIdSchema` below), not membership — the closed z.enum would reject
// every newly discovered model. Agents learn the legal values from the
// `list_available_chat_models` MCP tool instead of a schema enum.

import { z } from 'zod'

export const CHAT_MODEL_IDS = [
  'claude-fable-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const
export type ChatModelId = (typeof CHAT_MODEL_IDS)[number]

export interface ChatModelOption {
  id: ChatModelId
  label: string
}

export const CHAT_MODELS: readonly ChatModelOption[] = [
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
]

/** Boundary-validation shape for a model id now that the roster is DISCOVERED
 *  (the closed enum can't exist anymore): a `claude-…` id, nothing else. The
 *  engine is the real validator — an id it doesn't serve fails the turn with a
 *  visible, persisted error.
 *
 *  The trailing `[…]` group is the engine's CONTEXT-VARIANT suffix
 *  (`claude-opus-5[1m]` = Opus 5 with the 1M window) — a real id it both
 *  reports and accepts. Without it here the picker offered Opus and every
 *  turn that chose it was rejected at this boundary before reaching the
 *  engine (live-verified against the CLI's own roster, 2026-08-17). */
export const CHAT_MODEL_ID_PATTERN = /^claude-[a-z0-9][a-z0-9.-]{0,60}(?:\[[a-z0-9]{1,8}\])?$/

/** The one request-schema home for a turn's `model` field (all four turn
 *  routes). Legal values come from `providers.listModels` at runtime; agents
 *  learn them from the `list_available_chat_models` MCP tool (the delegate
 *  tools' descriptions point there — the generated MCP arg schema flattens
 *  this describe text away, so the field itself can't carry the pointer). */
export const ChatModelIdSchema = z
  .string()
  .regex(CHAT_MODEL_ID_PATTERN, 'Unsupported model.')
  .describe(
    'A Claude model id, e.g. "claude-opus-5". The legal values are whatever ' +
      'list_available_chat_models / GET /providers/:providerId/models returns.',
  )

/** The default when the user hasn't picked one — the current Opus (Kafi
 *  2026-08-19: the 4.8 default was stale once the 5 family shipped). */
export const DEFAULT_CHAT_MODEL = 'claude-opus-5'

/** Whether a free-form model string is one of the selectable options (type
 *  guard — narrows to `string` so callers can use it without a non-null cast). */
export function isSelectableChatModel(model: string | null | undefined): model is string {
  return model !== null && model !== undefined && (CHAT_MODEL_IDS as readonly string[]).includes(model)
}
