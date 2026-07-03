// The user-selectable Claude models for a chat turn (the per-chat model picker).
// A small curated allowlist — NOT every model the SDK accepts — so the UI stays
// simple and the route can validate against a closed set. The chosen id is
// passed to the Agent SDK's `options.model`; the model the session actually ran
// with is recorded on `chat_sessions.model` (drives the context-window
// denominator — see resolveContextWindow). Full ids, no date suffix, per the
// claude-api guidance.

export interface ChatModelOption {
  id: string
  label: string
}

export const CHAT_MODELS: readonly ChatModelOption[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
] as const

export const CHAT_MODEL_IDS = CHAT_MODELS.map((model) => model.id)

/** The default when the user hasn't picked one (the most capable). */
export const DEFAULT_CHAT_MODEL = 'claude-opus-4-8'

/** Whether a free-form model string is one of the selectable options (type
 *  guard — narrows to `string` so callers can use it without a non-null cast). */
export function isSelectableChatModel(model: string | null | undefined): model is string {
  return model !== null && model !== undefined && CHAT_MODEL_IDS.includes(model)
}
