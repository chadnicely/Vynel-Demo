// Pins the scope-membership predicate — every scope view (workspace room,
// global library, menu counts, paged reads) shares it, so what it excludes
// is invisible EVERYWHERE. The voice thread (voice-session arc) relies on
// exactly that: scope 'voice' matches no view, and since the fold now admits
// the voice chain (session-hardening D2) the exclusion has to be explicit
// rather than a side effect of never reaching this predicate.

import { describe, expect, it } from 'vitest'
import { isSessionInScope } from './sessions-overview.js'

describe('isSessionInScope', () => {
  it('a workspace view holds its own sessions regardless of scope kind', () => {
    expect(isSessionInScope({ scope: 'workspace', workspaceId: 'ws-1' }, 'ws-1')).toBe(true)
    expect(isSessionInScope({ scope: 'spawned', workspaceId: 'ws-1' }, 'ws-1')).toBe(true)
    expect(isSessionInScope({ scope: 'spawned', workspaceId: 'ws-2' }, 'ws-1')).toBe(false)
  })

  it('the global library holds only GLOBAL-grounded spawned sessions', () => {
    expect(isSessionInScope({ scope: 'spawned', workspaceId: null }, null)).toBe(true)
    expect(isSessionInScope({ scope: 'global', workspaceId: null }, null)).toBe(false)
  })

  it('the VOICE thread matches no scope view — it belongs to the Voice chat surface alone', () => {
    expect(isSessionInScope({ scope: 'voice', workspaceId: null }, null)).toBe(false)
    expect(isSessionInScope({ scope: 'voice', workspaceId: null }, 'ws-1')).toBe(false)
    // Even carrying a workspace id (a mis-stamped swap segment) it stays out —
    // the scope decides, not the room.
    expect(isSessionInScope({ scope: 'voice', workspaceId: 'ws-1' }, 'ws-1')).toBe(false)
  })
})
