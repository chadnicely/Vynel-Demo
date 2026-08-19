// The voice turn WATCHDOG default — ONE home for the silence bound every spoken
// leg arms per turn (session-hardening + round-2 R2-G): a turn that has said
// nothing for this long gets one honesty line and keeps streaming; its answer
// is still spoken when it lands. The daemon's env knob
// (`VYNEL_VOICE_TURN_WATCHDOG_MS`) defaults to it and carries its LIVE value on
// every wake; a browser session started from the mic button (no wake to carry
// it) falls back to this same number — so the native and browser legs can never
// drift apart on what "too long" means.
export const DEFAULT_VOICE_TURN_WATCHDOG_MS = 5 * 60_000
