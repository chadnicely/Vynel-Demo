// The thinking-effort vocabulary (session-library Slice ③ — the composer's
// effort picker, Claude-desktop parity). The levels mirror the Agent SDK's
// `EffortLevel`. There is deliberately NO 'auto' choice (Chad, 2026-07-30:
// "auto" is a permission mode, not a thinking level, and omitting the effort
// meant turns often showed no thinking at all) — the picker always sends an
// explicit level; background/channel turns still omit the field and keep the
// SDK's adaptive default. The provider seam keeps its own structurally-
// identical union (`@vynel/providers` doesn't import contracts — the
// model/mode precedent).

export const THINKING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingEffortLevel = (typeof THINKING_EFFORT_LEVELS)[number]

export interface ThinkingEffortOption {
  id: ThinkingEffortLevel
  label: string
}

/** The composer picker's choices — Claude-desktop parity, all five levels
 *  (Chad, 2026-07-21: match the desktop set; the SDK silently downgrades a
 *  level the selected model doesn't support). */
export const THINKING_EFFORT_OPTIONS: readonly ThinkingEffortOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra' },
  { id: 'max', label: 'Max' },
] as const

/** High matches Claude Code's own default effort. */
export const DEFAULT_THINKING_EFFORT: ThinkingEffortLevel = 'high'
