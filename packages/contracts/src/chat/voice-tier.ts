// The VOICE TIER — the one home for what the spoken surfaces run on. Revised
// 2026-08-27 (Kafi, the voice-lean tier): HAIKU 4.5 at LOW effort — the
// fastest first spoken syllable — made safe by the lean context that ships
// with it (`hostResources: 'none'`: no CLAUDE.md, no native tools, the voice
// base alone), so the 200k window is no longer the 2026-08-19 crash class:
// the thread stays small, the boundary swap fires at 85% of ITS window, and
// when a resumed head still cannot fit the pin the turn falls back to
// `VOICE_TIER_FALLBACK_MODEL` (sonnet's 1M) — those two ARE the entire voice
// model universe; nothing else ever runs a spoken turn. `resolveVoiceTierSettings`
// is the clamp's one home; `VYNEL_VOICE_TIER_MODEL` (env, validated to the
// pair) is the A/B lever. Consumed by the daemon's wake line + call loop, the
// web overlay leg, and the Voice chat panel's composer DEFAULTS — one
// constant, four surfaces, zero drift (the server forces it for voice turns
// regardless of what a stale build sends).
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

export const VOICE_TIER_MODEL = 'claude-haiku-4-5'
/** Where a spoken turn lands when the pin cannot hold the resumed head's
 *  occupancy (the fit clamp) — the ONLY other model a voice turn may run. */
export const VOICE_TIER_FALLBACK_MODEL = 'claude-sonnet-5'
/** The whole voice model universe — the env override validates against it. */
export const VOICE_TIER_ALLOWED_MODELS = [VOICE_TIER_MODEL, VOICE_TIER_FALLBACK_MODEL] as const
/** What the LEGACY senders still transmit (daemon wake, web overlay, the
 *  panel's read-only chip). The server-side truth since the lean tier: a
 *  voice turn runs with extended thinking DISABLED entirely (`disableThinking`
 *  on every voice leg — a thought block is dead air before the first spoken
 *  syllable), and the provider drops any effort sent beside it. */
export const VOICE_TIER_THINKING_EFFORT: ThinkingEffortLevel = 'low'
// The voice tier's PERMISSION MODE (Kafi 2026-08-19: "no card for anything
// through voice or chat"): `auto` — no Vynel card of any kind on a hands-free
// surface; Claude's own safety check still applies. Every voice leg (daemon
// wake, live call, web overlay, typed Voice-chat turn) runs under it and the
// server enforces it for `voice` turns regardless of what the caller sends.
// A `SessionMode` literal (not the provider type) so this db-free home stays
// importable by the daemon and the web app alike.
export const VOICE_TIER_MODE = 'auto' as const
