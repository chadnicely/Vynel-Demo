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
 * - `auto` → `auto` (SDK `auto`): Anthropic's safety classifier gates each
 *   action; the irreversible floor still cards.
 * - `bypass` → `bypass-with-behavior-gate` (SDK `bypassPermissions`): runs
 *   without prompts; only the irreversible floor still cards.
 */
export type SessionPermissionMode = 'ask' | 'auto' | 'bypass-with-behavior-gate'

/** Map a user-facing `SessionMode` to the provider permission mode. */
export function toPermissionMode(mode: SessionMode): SessionPermissionMode {
  switch (mode) {
    case 'ask':
      return 'ask'
    case 'auto':
      return 'auto'
    case 'bypass':
      return 'bypass-with-behavior-gate'
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
    description: 'Runs autonomously with a safety check on each action; irreversible actions still ask.',
  },
  {
    mode: 'bypass',
    label: 'Bypass',
    description: 'Runs without prompts; only irreversible actions still ask.',
  },
] as const

/**
 * The default mode for a new session — `ask` for v1 (explicit opt-in to
 * autonomy). Flipping the launch default to `auto` or `bypass` is a one-line
 * change here.
 */
export const DEFAULT_SESSION_MODE: SessionMode = 'ask'
