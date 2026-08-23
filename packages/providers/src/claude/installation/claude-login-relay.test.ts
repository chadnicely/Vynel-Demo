// The LOCAL login relay against a scripted fake child standing in for the
// bundled `claude auth login --claudeai`: announce the browser, print the
// fallback link as an OSC-8 hyperlink (the real 2.1.235 paint), then either
// exit 0 on its own when the browser's localhost callback lands, or judge a
// pasted code. The real spawn is one seam (`spawnLoginProcess`) — everything
// else here is the relay's own state machine.

import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  ClaudeLoginRelay,
  type ClaudeLoginProcess,
  type ClaudeLoginState,
} from './claude-login-relay.js'

const AUTH_URL =
  'https://claude.com/cai/oauth/authorize?code=true&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=abc'
const GOOD_CODE = 'paste-me-1234'

// Exactly what the CLI writes to a pipe: the link as `ESC ] 8 ; ; href BEL
// text ESC ] 8 ; ; BEL`, then the paste prompt with no newline.
const PAINTED_LINK = `\u001b]8;;${AUTH_URL}\u0007${AUTH_URL}\u001b]8;;\u0007`
const REAL_GREETING =
  'Opening browser to sign in…\n' +
  `If the browser didn't open, visit: ${PAINTED_LINK}\n` +
  'Paste code here if prompted > '

interface FakeLogin extends ClaudeLoginProcess {
  /** The browser's redirect landed on the CLI's localhost listener. */
  completeFromBrowser(): void
  /** The CLI gave up on its own, with its parting words. */
  refuse(words: string): void
  /** More of the CLI's output arrives (a later pipe chunk). */
  append(text: string): void
  writes: string[]
}

function fakeLoginProcess(options: { greeting?: string; exitEarlyWith?: number } = {}): FakeLogin {
  let output = options.greeting ?? REAL_GREETING
  const writes: string[] = []
  let finish: (code: number | null) => void = () => {}
  const finished = new Promise<number | null>((resolveExit) => {
    finish = resolveExit
  })
  if (options.exitEarlyWith !== undefined) finish(options.exitEarlyWith)
  return {
    writes,
    output: () => output,
    writeLine: (line) => {
      writes.push(line)
      if (line === GOOD_CODE) {
        output += '\n\u001b[32mLogin successful.\u001b[0m\n'
        finish(0)
      } else {
        output += '\n\u001b[31mInvalid code.\u001b[0m\n'
        finish(1)
      }
    },
    kill: () => finish(null),
    completeFromBrowser: () => {
      output += '\nLogged in as someone@example.com\n'
      finish(0)
    },
    refuse: (words) => {
      output += `\n${words}\n`
      finish(1)
    },
    append: (text) => {
      output += text
    },
    finished,
  }
}

/** Poll the relay the way the dialog does, until the CLI's verdict. */
async function settled(relay: ClaudeLoginRelay, loginId: string): Promise<ClaudeLoginState> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const state = relay.read(loginId)
    if (state.phase === 'signed-in' || state.phase === 'failed') return state
    await new Promise((resolveTick) => setTimeout(resolveTick, 20))
  }
  return relay.read(loginId)
}

const nextTick = () => new Promise((resolveTick) => setTimeout(resolveTick, 0))

afterEach(() => {
  vi.useRealTimers()
})

describe('ClaudeLoginRelay', () => {
  it('opens awaiting the browser with the fallback link cut cleanly out of the terminal hyperlink', async () => {
    const relay = new ClaudeLoginRelay()
    try {
      const begun = await relay.begin({ spawnLoginProcess: () => fakeLoginProcess() })
      expect(begun.phase).toBe('awaiting-browser')
      expect(begun.authorizationUrl).toBe(AUTH_URL)
    } finally {
      relay.discardAll()
    }
  })

  it('waits for the whole link when a pipe chunk cuts it short', async () => {
    const relay = new ClaudeLoginRelay()
    const child = fakeLoginProcess({ greeting: `visit: \u001b]8;;${AUTH_URL.slice(0, 40)}` })
    try {
      const begun = relay.begin({ spawnLoginProcess: () => child })
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
      child.append(`${AUTH_URL.slice(40)}\u0007${AUTH_URL}\u001b]8;;\u0007\nPaste code here > `)
      expect((await begun).authorizationUrl).toBe(AUTH_URL)
    } finally {
      relay.discardAll()
    }
  })

  it("signs in when the browser's callback lands — the CLI exits 0, nothing is pasted", async () => {
    const relay = new ClaudeLoginRelay()
    const child = fakeLoginProcess()
    try {
      const begun = await relay.begin({ spawnLoginProcess: () => child })
      expect(relay.read(begun.loginId).phase).toBe('awaiting-browser')
      child.completeFromBrowser()
      const verdict = await settled(relay, begun.loginId)
      expect(verdict.phase).toBe('signed-in')
      expect(verdict.errorMessage).toBeNull()
      expect(child.writes).toEqual([])
    } finally {
      relay.discardAll()
    }
  })

  it('falls back to a pasted code: relays it, then reports signed-in', async () => {
    const relay = new ClaudeLoginRelay()
    const child = fakeLoginProcess()
    try {
      const begun = await relay.begin({ spawnLoginProcess: () => child })
      const submitted = relay.submitCode(begun.loginId, ` ${GOOD_CODE} `)
      expect(submitted.phase).toBe('finishing')
      expect(child.writes).toEqual([GOOD_CODE])
      expect((await settled(relay, begun.loginId)).phase).toBe('signed-in')
    } finally {
      relay.discardAll()
    }
  })

  it('reports a rejected code as failed, quoting the CLI without its paint or the link', async () => {
    const relay = new ClaudeLoginRelay()
    try {
      const begun = await relay.begin({ spawnLoginProcess: () => fakeLoginProcess() })
      relay.submitCode(begun.loginId, 'wrong-code')
      const verdict = await settled(relay, begun.loginId)
      expect(verdict.phase).toBe('failed')
      expect(verdict.errorMessage).toContain('Invalid code.')
      expect(verdict.errorMessage).not.toContain('\u001b')
      expect(verdict.errorMessage).not.toContain('https://')
    } finally {
      relay.discardAll()
    }
  })

  it('keeps a refusal that cites a URL — only the painted link line is noise', async () => {
    const relay = new ClaudeLoginRelay()
    const child = fakeLoginProcess()
    try {
      const begun = await relay.begin({ spawnLoginProcess: () => child })
      child.refuse('error: this account has no subscription — see https://claude.ai/upgrade')
      const verdict = await settled(relay, begun.loginId)
      expect(verdict.phase).toBe('failed')
      expect(verdict.errorMessage).toContain('https://claude.ai/upgrade')
      expect(verdict.errorMessage).not.toContain(AUTH_URL)
    } finally {
      relay.discardAll()
    }
  })

  it('a late paste after the browser already signed in changes nothing', async () => {
    const relay = new ClaudeLoginRelay()
    const child = fakeLoginProcess()
    try {
      const begun = await relay.begin({ spawnLoginProcess: () => child })
      child.completeFromBrowser()
      await nextTick()

      const late = relay.submitCode(begun.loginId, GOOD_CODE)
      expect(late.phase).toBe('signed-in')
      expect(child.writes).toEqual([])
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

  it('explains itself when the command offers no link (no subscription, a torn engine)', async () => {
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

  it('takes an exit 0 before any link as the CLI saying done', async () => {
    const relay = new ClaudeLoginRelay()
    try {
      const begun = await relay.begin({
        spawnLoginProcess: () =>
          fakeLoginProcess({
            greeting: 'Already logged in as someone@example.com\n',
            exitEarlyWith: 0,
          }),
      })
      expect(begun.phase).toBe('signed-in')
      expect(begun.authorizationUrl).toBeNull()
    } finally {
      relay.discardAll()
    }
  })

  it('a new begin discards the pending one — one login at a time', async () => {
    const relay = new ClaudeLoginRelay()
    try {
      const first = await relay.begin({ spawnLoginProcess: () => fakeLoginProcess() })
      const second = await relay.begin({ spawnLoginProcess: () => fakeLoginProcess() })
      expect(() => relay.read(first.loginId)).toThrow()
      expect(relay.read(second.loginId).phase).toBe('awaiting-browser')
    } finally {
      relay.discardAll()
    }
  })

  it('404s a code submitted for a session that was never begun', () => {
    const relay = new ClaudeLoginRelay()
    expect(() => relay.submitCode('nope', 'code')).toThrow()
    expect(() => relay.read('nope')).toThrow()
  })

  it('every read is a heartbeat — a user slow in the browser is not cut off while the dialog still asks', async () => {
    vi.useFakeTimers()
    const relay = new ClaudeLoginRelay()
    try {
      const begun = await relay.begin({ spawnLoginProcess: () => fakeLoginProcess() })
      vi.advanceTimersByTime(9 * 60 * 1000)
      expect(relay.read(begun.loginId).phase).toBe('awaiting-browser')
      vi.advanceTimersByTime(9 * 60 * 1000)
      expect(relay.read(begun.loginId).phase).toBe('awaiting-browser')
      // Abandoned for good: ten silent minutes release the session.
      vi.advanceTimersByTime(10 * 60 * 1000 + 1)
      expect(() => relay.read(begun.loginId)).toThrow()
    } finally {
      relay.discardAll()
    }
  })

  it('a code arriving after the CLI died on its own conflicts — never a write to the dead child', async () => {
    const relay = new ClaudeLoginRelay()
    const child = fakeLoginProcess()
    const begun = await relay.begin({ spawnLoginProcess: () => child })

    // The CLI's own auth timeout fires before the browser answers.
    child.refuse('error: auth timed out')
    await nextTick()
    expect(relay.read(begun.loginId).phase).toBe('failed')

    expect(() => relay.submitCode(begun.loginId, GOOD_CODE)).toThrow(/timed out/)
    expect(child.writes).toEqual([])
    // The dead session is discarded with the refusal — a retry begins fresh.
    expect(() => relay.read(begun.loginId)).toThrow()
  })
})
