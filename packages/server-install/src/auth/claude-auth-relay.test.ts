// The auth relay against a REAL ssh2 PTY channel, with the fake server
// standing in for `claude auth login`: print a URL, block on stdin, accept the
// code, exit 0. Verified against the real binary (claude 2.1.220) that the
// command exists and blocks on input — this proves OUR half of the handshake.

import { describe, it, expect } from 'vitest'
import { startFakeSshServer, type FakeSshServer } from '@vynel/testing'
import { ClaudeAuthRelay } from './claude-auth-relay.js'
import { readRemoteClaudeAuthStatus } from './read-claude-auth-status.js'
import { openServerConnection } from '../connecting/server-connection.js'

const AUTH_URL = 'https://claude.ai/oauth/authorize?code=1&state=abc'
const GOOD_CODE = 'paste-me-1234'

/** The fake CLI: greets with the URL — painted as an OSC-8 terminal
 *  hyperlink, the way the real CLI writes it — then judges the pasted code. */
function claudeLoginHandler(): NonNullable<
  Parameters<typeof startFakeSshServer>[0]
> {
  return {
    interactiveHandler: ({ line }) => {
      if (line === null) {
        return {
          write:
            'Open this URL to authorize:\r\n' +
            `\u001b]8;;${AUTH_URL}\u0007${AUTH_URL}\u001b]8;;\u0007\r\nPaste code here: `,
        }
      }
      if (line === GOOD_CODE) return { write: '\r\nLogin successful.\r\n', exitCode: 0 }
      return { write: '\r\nInvalid code.\r\n', exitCode: 1 }
    },
  }
}

function connectionOpener(server: FakeSshServer) {
  return () =>
    openServerConnection({
      host: '127.0.0.1',
      port: server.port,
      username: 'dana',
      credentials: { authKind: 'password', password: 'sourdough' },
      pinnedHostKeyFingerprint: null,
    })
}

async function settle(): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
}

describe('ClaudeAuthRelay', () => {
  it('surfaces the authorization url, relays the pasted code, and reports signed-in', async () => {
    const server = await startFakeSshServer(claudeLoginHandler())
    const relay = new ClaudeAuthRelay()
    try {
      const begun = await relay.begin('install-1', { openConnection: connectionOpener(server) })
      expect(begun.phase).toBe('awaiting-authorization')
      expect(begun.authorizationUrl).toBe(AUTH_URL)

      const submitted = relay.submitCode('install-1', ` ${GOOD_CODE} `)
      expect(submitted.phase).toBe('finishing')

      await settle()
      expect(relay.read('install-1').phase).toBe('signed-in')
      // The real command ran on a PTY — a bare pipe is what `claude auth
      // login` refuses.
      expect(server.executedCommands).toContain('claude auth login')
    } finally {
      relay.discardAll()
      await server.close()
    }
  })

  it('reports a rejected code as failed, quoting the CLI', async () => {
    const server = await startFakeSshServer(claudeLoginHandler())
    const relay = new ClaudeAuthRelay()
    try {
      await relay.begin('install-1', { openConnection: connectionOpener(server) })
      relay.submitCode('install-1', 'wrong-code')
      await settle()
      const state = relay.read('install-1')
      expect(state.phase).toBe('failed')
      expect(state.errorMessage).toContain('Invalid code')
    } finally {
      relay.discardAll()
      await server.close()
    }
  })

  it('refuses an empty code instead of waking the CLI', async () => {
    const server = await startFakeSshServer(claudeLoginHandler())
    const relay = new ClaudeAuthRelay()
    try {
      await relay.begin('install-1', { openConnection: connectionOpener(server) })
      expect(() => relay.submitCode('install-1', '   ')).toThrow(/Paste the code/)
    } finally {
      relay.discardAll()
      await server.close()
    }
  })

  it('explains itself when the command offers no url (no subscription, not installed)', async () => {
    const server = await startFakeSshServer({
      interactiveHandler: ({ line }) =>
        line === null
          ? { write: 'error: this command requires a Claude subscription\r\n', exitCode: 1 }
          : {},
    })
    const relay = new ClaudeAuthRelay()
    try {
      await expect(
        relay.begin('install-1', { openConnection: connectionOpener(server) }),
      ).rejects.toThrow(/subscription/)
    } finally {
      relay.discardAll()
      await server.close()
    }
  })

  it('404s a code submitted for a session that was never begun', async () => {
    const relay = new ClaudeAuthRelay()
    expect(() => relay.submitCode('nope', 'code')).toThrow()
    expect(() => relay.read('nope')).toThrow()
  })
})

describe('readRemoteClaudeAuthStatus', () => {
  it('reads the CLI verdict without ever touching a credential', async () => {
    const server = await startFakeSshServer({
      execHandler: (command) =>
        command === 'claude auth status'
          ? { stdout: 'Signed in as dana@example.com\n' }
          : { exitCode: 1 },
    })
    try {
      const connection = await connectionOpener(server)()
      const status = await readRemoteClaudeAuthStatus(connection)
      expect(status.isSignedIn).toBe(true)
      expect(status.detail).toContain('dana@example.com')
      connection.close()
    } finally {
      await server.close()
    }
  })

  it('reports not-signed-in when the CLI exits non-zero', async () => {
    const server = await startFakeSshServer({
      execHandler: () => ({ stderr: 'Not authenticated\n', exitCode: 1 }),
    })
    try {
      const connection = await connectionOpener(server)()
      const status = await readRemoteClaudeAuthStatus(connection)
      expect(status.isSignedIn).toBe(false)
      expect(status.detail).toContain('Not authenticated')
      connection.close()
    } finally {
      await server.close()
    }
  })
})
