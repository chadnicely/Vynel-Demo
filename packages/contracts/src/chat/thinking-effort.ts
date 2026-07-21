// The thinking-effort vocabulary (session-library Slice ③ — the composer's
// effort picker, Claude-desktop parity). The runtime levels mirror the Agent
// SDK's `EffortLevel`; `'auto'` is a PICKER-ONLY value meaning "omit the
// option" (the SDK's adaptive default — today's behavior, byte-for-byte).
// The provider seam keeps its own structurally-identical union
// (`@vynel/providers` doesn't import contracts — the model/mode precedent).

export const THINKING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingEffortLevel = (typeof THINKING_EFFORT_LEVELS)[number]

export interface ThinkingEffortOption {
  id: 'auto' | ThinkingEffortLevel
  label: string
}

/** The composer picker's choices — Claude-desktop parity, all five levels
 *  (Chad, 2026-07-21: match the desktop set; the SDK silently downgrades a
 *  level the selected model doesn't support). */
export const THINKING_EFFORT_OPTIONS: readonly ThinkingEffortOption[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra' },
  { id: 'max', label: 'Max' },
] as const

export const DEFAULT_THINKING_EFFORT = 'auto'
