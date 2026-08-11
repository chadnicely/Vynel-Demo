// The user-facing session permission mode + its mapping to the provider's
// permission mode. This is the single home for the mode model that the turn
// paths, the web UI, and (later) workflows all consume.
//
// `@vynel/session` stays self-contained: the resolver returns the literal
// provider permission-mode strings rather than importing `@vynel/providers`,
// so a workflow can use the mode model without pulling the SDK. Drift is caught
// downstream — where the result is assigned to a
// `StartChatSessionInput.permissionMode`, the literal must be a member of
// `@vynel/providers`'s `ClaudePermissionMode` or the consumer fails to typecheck.

/** The three user-facing session modes. */
export type SessionMode = 'ask' | 'auto' | 'bypass'

/**
 * The provider permission-mode string each `SessionMode` maps to — a subset of
 * `@vynel/providers`'s `ClaudePermissionMode`:
 * - `ask` → `ask` (SDK `default`): approve every tool.
 * - `auto` → `auto` (SDK `auto`): runs without asking — no Vynel card of any
 *   kind, not even for a classifier escalation (Kafi 2026-08-11). The
 *   provider's own safety check still applies.
 * - `bypass` → `bypass` (SDK `bypassPermissions`): runs everything without
 *   prompts — the user's explicit grant (2026-07-30: bypass means bypass).
 *   The provider's separate `bypass-with-behavior-gate` (floor still cards)
 *   stays the UNATTENDED default for turns no user mode reaches.
 */
export type SessionPermissionMode = 'ask' | 'auto' | 'bypass'

/** Map a user-facing `SessionMode` to the provider permission mode. */
export function toPermissionMode(mode: SessionMode): SessionPermissionMode {
  switch (mode) {
    case 'ask':
      return 'ask'
    case 'auto':
      return 'auto'
    case 'bypass':
      return 'bypass'
  }
}

/**
 * Canonical metadata for the three modes — the single source the web UI renders
 * (and the API/docs reference) so labels and meanings never drift across
 * surfaces. Sentence-case labels, no emoji (per `docs/ui-guideline.md`).
 */
export const SESSION_MODES: readonly {
  mode: SessionMode
  label: string
  description: string
}[] = [
  {
    mode: 'ask',
    label: 'Ask',
    description: 'Approve every tool before it runs.',
  },
  {
    mode: 'auto',
    label: 'Auto',
    // Was "…asks only when unsure", which stopped being true when auto stopped
    // carding (Kafi 2026-08-11). A security-relevant mode must never advertise
    // a protection it no longer has — this wording is honest whether or not the
    // provider's own classifier can still refuse a call outright.
    description: "Runs without asking; Claude's own safety check still applies.",
  },
  {
    mode: 'bypass',
    label: 'Bypass',
    description: 'Runs everything without asking.',
  },
] as const

/**
 * The default mode for a new session — `ask` for v1 (explicit opt-in to
 * autonomy). Flipping the launch default to `auto` or `bypass` is a one-line
 * change here.
 */
export const DEFAULT_SESSION_MODE: SessionMode = 'ask'
