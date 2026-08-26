// `ActiveSessionRegistry` — the in-memory map of in-flight sessions so they
// can be interrupted from outside the SDK callback. Each concrete provider
// holds one as a private field. See `docs/blueprints/providers/blueprint.md §9`.

import type { ClaudePermissionMode } from './start-chat-session-input.js'

export type ActiveSessionRecord = {
  sessionId: string
  startedAt: Date
  /** Cancels the underlying runtime session when called. */
  cancel: () => Promise<void>
  /** Changes the permission mode of the turn ALREADY RUNNING. Without it, a
   *  mode change only reaches the next turn, and a person who switched to Ask
   *  mid-run keeps watching the old mode act (Chad, 2026-08-25). */
  setPermissionMode?: (mode: ClaudePermissionMode) => Promise<void>
}

export class ActiveSessionRegistry {
  private readonly sessionsBySessionId = new Map<string, ActiveSessionRecord>()

  register(record: ActiveSessionRecord): void {
    this.sessionsBySessionId.set(record.sessionId, record)
  }

  unregister(sessionId: string): void {
    this.sessionsBySessionId.delete(sessionId)
  }

  isActive(sessionId: string): boolean {
    return this.sessionsBySessionId.has(sessionId)
  }

  async interrupt(sessionId: string): Promise<boolean> {
    const record = this.sessionsBySessionId.get(sessionId)
    if (!record) {
      return false
    }
    await record.cancel()
    this.sessionsBySessionId.delete(sessionId)
    return true
  }

  /** Push a mode change into the turn already running. False when the session
   *  is not active (or its runtime cannot switch) — the caller has still
   *  persisted the row, so the next turn carries it regardless. */
  async setPermissionMode(sessionId: string, mode: ClaudePermissionMode): Promise<boolean> {
    const record = this.sessionsBySessionId.get(sessionId)
    if (!record?.setPermissionMode) {
      return false
    }
    await record.setPermissionMode(mode)
    return true
  }

  listActiveSessionIds(): string[] {
    return Array.from(this.sessionsBySessionId.keys())
  }
}
