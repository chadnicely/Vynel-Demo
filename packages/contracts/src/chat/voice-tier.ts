// The VOICE TIER — the one home for what the spoken surfaces run on (Kafi
// 2026-08-19): a real model at LOW effort — fast to first token so it speaks
// back quickly, capable enough to route work like the global brain, and a 1M
// window so the spoken thread can never outgrow its own pin (the haiku-200k
// crash class). Consumed by the daemon's wake line + call loop, the web
// overlay leg, and the Voice chat panel's composer DEFAULTS — one constant,
// four surfaces, zero drift.
//
// Lives in `@vynel/contracts` (the api↔web↔daemon shared, db-free home) per
// the promotion rule: the third consumer made the copies a liability.

import type { ThinkingEffortLevel } from './thinking-effort.js'

export const VOICE_TIER_MODEL = 'claude-sonnet-5'
export const VOICE_TIER_THINKING_EFFORT: ThinkingEffortLevel = 'low'
