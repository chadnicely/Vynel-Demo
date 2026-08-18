// The LOCAL login relay against a scripted fake child standing in for
// `claude auth login --claudeai`: print a URL, block on stdin, judge the
// code, exit. The real spawn is one seam (`spawnLoginProcess`) — everything
// else here is the relay's own state machine, the same half the server-side
// relay proves over a real PTY.

import { describe, it, expect } from 'vitest'
import { ClaudeLoginRelay, type ClaudeLoginProcess } from './claude-login-relay.js'

const AUTH_URL = 'https://claude.ai/oauth/authorize?code=1&state=abc'
const GOOD_CODE = 'paste-me-1234'

/** The fake CLI: greets with the URL, then judges the pasted code. */
function fakeLoginProcess(
  options: { greeting?: string; exitEarlyWith?: number } = {},
): ClaudeLoginProcess {
  let output = options.greeting ?? `Open this URL to authorize:\n${AUTH_URL}\nPaste code here: `
  let finish: (code: number | null) => void = () => {}
  const finished = new Promise<number | null>((resolveExit) => {
    finish = resolveExit
  })
  if (options.exitEarlyWith !== undefined) finish(options.exitEarlyWith)
  return {
    output: () => output,
    writeLine: (line) => {
      if (line === GOOD_CODE) {
        output += '\nLogin successful.\n'
        finish(0)
      } else {
        output += '\nInvalid code.\n'
        finish(1)
      }
    },
    kill: () => finish(null),
    finished,
  }
}

describe('ClaudeLoginRelay', () => {
  it('surfaces the authorization url, relays the pasted code, and reports signed-in', async () => {
    const relay = new ClaudeLoginRelay()
    try {
      const begun = await relay.begin({ spawnLoginProcess: () => fakeLoginProcess() })
      expect(begun.phase).toBe('awaiting-code')
      expect(begun.authorizationUrl).toBe(AUTH_URL)

      const submitted = relay.submitCode(begun.loginId, ` ${GOOD_CODE} `)
      expect(submitted.phase).toBe('finishing')

      const settled = await relay.waitForOutcome(begun.loginId, 2000)
      expect(settled.phase).toBe('signed-in')
    } finally {
      relay.discardAll()
    }
  })

  it('reports a rejected code as failed, quoting the CLI', async () => {
    const relay = new ClaudeLoginRelay()
    try {
      const begun = await relay.begin({ spawnLoginProcess: () => fakeLoginProcess() })
      relay.submitCode(begun.loginId, 'wrong-code')
      const settled = await relay.waitForOutcome(begun.loginId, 2000)
      expect(settled.phase).toBe('failed')
      expect(settled.errorMessage).toContain('Invalid code')
    } finally {
      relay.discardAll()
    }
  })

  it('refuses an empty code instead of waking the CLI', async () => {
    const relay = new ClaudeLoginRelay()
    try {
      const begun = await relay.begin({ spawnLoginProcess: () => fakeLoginProcess() })
      expect(() => relay.submitCode(begun.loginId, '   ')).toThrow(/Paste the code/)
    } finally {
      relay.discardAll()
    }
  })

  it('explains itself when the command offers no url (already signed in, not installed)', async () => {
    const relay = new ClaudeLoginRelay()
    await expect(
      relay.begin({
        spawnLoginProcess: () =>
          fakeLoginProcess({
            greeting: 'error: this command requires a Claude subscription\n',
            exitEarlyWith: 1,
          }),
      }),
    ).rejects.toThrow(/subscription/)
  })

  it('a new begin discards the pending one — one login at a time', async () => {
    const relay = new ClaudeLoginRelay()
    try {
      const first = await relay.begin({ spawnLoginProcess: () => fakeLoginProcess() })
      const second = await relay.begin({ spawnLoginProcess: () => fakeLoginProcess() })
      expect(() => relay.read(first.loginId)).toThrow()
      expect(relay.read(second.loginId).phase).toBe('awaiting-code')
    } finally {
      relay.discardAll()
    }
  })

  it('404s a code submitted for a session that was never begun', () => {
    const relay = new ClaudeLoginRelay()
    expect(() => relay.submitCode('nope', 'code')).toThrow()
    expect(() => relay.read('nope')).toThrow()
  })

  it('a code arriving after the CLI died on its own conflicts — never a write to the dead child', async () => {
    let dieNow: (code: number) => void = () => {}
    const writes: string[] = []
    const process: ClaudeLoginProcess = {
      output: () => `Open this URL:\n${AUTH_URL}\nerror: auth timed out\n`,
      writeLine: (line) => writes.push(line),
      kill: () => {},
      finished: new Promise<number | null>((resolveExit) => {
        dieNow = resolveExit
      }),
    }
    const relay = new ClaudeLoginRelay()
    const begun = await relay.begin({ spawnLoginProcess: () => process })

    // The CLI's own auth timeout fires before the user pastes the code.
    dieNow(1)
    const died = await relay.waitForOutcome(begun.loginId, 2000)
    expect(died.phase).toBe('failed')

    expect(() => relay.submitCode(begun.loginId, GOOD_CODE)).toThrow(/timed out/)
    expect(writes).toEqual([])
    // The dead session is discarded with the refusal — a retry begins fresh.
    expect(() => relay.read(begun.loginId)).toThrow()
  })
})
