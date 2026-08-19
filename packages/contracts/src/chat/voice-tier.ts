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
//
// THE RULE THAT MAKES THIS CONSTANT THE TRUTH (session-hardening D2): a VOICE
// turn NEITHER READS NOR WRITES the per-session settings. It does not resolve
// `chat_sessions.sessionMode / selectedModel / thinkingEffort` — the server
// forces the three values below over whatever the caller sent — and it writes
// nothing back, so no voice row ever holds a setting. The consequences are
// deliberate and load-bearing:
//
//   - every leg sends the tier explicitly (daemon wake, live call, web
//     overlay, the typed Voice-chat panel) so the request already says what
//     the server would force anyway;
//   - the Voice panel's chips are READ-ONLY and its composer carries no
//     session id: there is nothing to change and nothing to change it on;
//   - `updateChatSessionSettings` refuses a `voice`-scope row outright (403) —
//     a stored value there could only be a lie the UI shows and no turn honours.
//
// A spoken thread has one way to run. If that ever stops being true, it stops
// here first — not in a stream, a composer, or a daemon.

import type { ThinkingEffortLevel } from './thinking-effort.js'

export const VOICE_TIER_MODEL = 'claude-sonnet-5'
export const VOICE_TIER_THINKING_EFFORT: ThinkingEffortLevel = 'low'
// The voice tier's PERMISSION MODE (Kafi 2026-08-19: "no card for anything
// through voice or chat"): `auto` — no Vynel card of any kind on a hands-free
// surface; Claude's own safety check still applies. Every voice leg (daemon
// wake, live call, web overlay, typed Voice-chat turn) runs under it and the
// server enforces it for `voice` turns regardless of what the caller sends.
// A `SessionMode` literal (not the provider type) so this db-free home stays
// importable by the daemon and the web app alike.
export const VOICE_TIER_MODE = 'auto' as const
