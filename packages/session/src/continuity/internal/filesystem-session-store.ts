// Phase-1 filesystem implementation of `SessionStore`. A session is
// persisted as `<rootDir>/<sessionId>.jsonl` (the SDK's filesystem default
// shape). Holds the root directory as injected config — the one legitimate
// stateful-object case (a store), per the naming reference ("classes — only
// for stateful objects").
//
// `rootDir` is injected (not hardcoded to `~/.claude/projects/...`) so the
// store is testable against a temp dir and so the exact Claude-path
// encoding stays the provider's concern — this is the SEAM, not the
// provider's path logic.

import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionStore, SessionLocation } from '../session-store.js'

export class FilesystemSessionStore implements SessionStore {
  constructor(private readonly rootDir: string) {}

  async findSessionLocation(sessionId: string): Promise<SessionLocation | null> {
    const path = join(this.rootDir, `${sessionId}.jsonl`)
    try {
      await access(path)
      return path
    } catch {
      return null
    }
  }

  async hasSession(sessionId: string): Promise<boolean> {
    return (await this.findSessionLocation(sessionId)) !== null
  }
}
