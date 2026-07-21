// The user-selectable Claude models for a chat turn (the per-chat model picker).
// A small curated allowlist — NOT every model the SDK accepts — so the UI stays
// simple and the route can validate against a closed set. The chosen id is
// passed to the Agent SDK's `options.model`; the model the session actually ran
// with is recorded on `chat_sessions.model` (drives the context-window
// denominator — see resolveContextWindow). Full ids, no date suffix, per the
// claude-api guidance.

// The ids as a const TUPLE (the THINKING_EFFORT_LEVELS pattern) so route schemas
// can use `z.enum(CHAT_MODEL_IDS)` — an enum flows the actual allowlist into the
// OpenAPI spec and the generated MCP tool schemas, where a `.refine` emits only a
// bare string (the cf15137 review catch: the delegating agent had no way to know
// the legal ids).
export const CHAT_MODEL_IDS = [
  'claude-fable-5',
  'claude-opus-4-8',
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
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
]

/** The default when the user hasn't picked one (the most capable). */
export const DEFAULT_CHAT_MODEL = 'claude-opus-4-8'

/** Whether a free-form model string is one of the selectable options (type
 *  guard — narrows to `string` so callers can use it without a non-null cast). */
export function isSelectableChatModel(model: string | null | undefined): model is string {
  return model !== null && model !== undefined && (CHAT_MODEL_IDS as readonly string[]).includes(model)
}
