// The `SessionStore` seam — the abstraction over WHERE the SDK persists a
// session's transcript/state. Phase 1 = the filesystem (Claude Code's
// `~/.claude/projects/.../*.jsonl`, wrapped by `FilesystemSessionStore`);
// Phase 2 = a cloud store. Defining the interface NOW makes the Phase-2
// cloud migration data-only, not a rewrite. Spec:
// `docs/agent-base/session-continuity.md` "Key choices" + the SDK matrix
// caveat #1 (`sessionStore` / `importSessionToStore` are `@alpha` — we wrap
// them behind OUR interface rather than depend on them directly yet).
//
// Phase-1 scope is deliberately minimal (existence + location lookup) — the
// operations the future bridge needs to fork/seed/repoint. The richer
// import/export surface lands with the bridge unit + the Phase-2 cloud impl.

export type SessionLocation = string

export interface SessionStore {
  /** Whether a session is persisted in the store. */
  hasSession(sessionId: string): Promise<boolean>

  /**
   * The opaque location handle for a session — Phase 1: the absolute file
   * path of its transcript; Phase 2: a cloud key. Null when not present.
   */
  findSessionLocation(sessionId: string): Promise<SessionLocation | null>
}

export { FilesystemSessionStore } from './internal/filesystem-session-store.js'
