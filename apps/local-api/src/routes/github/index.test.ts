// Integration tests for the `/github/...` routes. Full HTTP stack over a REAL
// `GitHubConnection` whose I/O is faked (a scripted runner + a scripted
// sign-in process) — the CLI is never spawned. The routes own nothing but the
// shaping; the three honest answers and the sign-in relay are proven here
// end to end.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { GitHubConnection, type GitHubSignInProcess } from '@vynel/github'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function signedInConnection(handle = 'chadnicely') {
  return new GitHubConnection({
    runCommand: async () => ({
      stdout: '',
      stderr: `✓ Logged in to github.com account ${handle} (keyring)`,
    }),
  })
}

function scriptedSignIn(text: string, exitCode: number): () => GitHubSignInProcess {
  return () => {
    let finish: (code: number | null) => void = () => {}
    const finished = new Promise<number | null>((resolve) => {
      finish = resolve
    })
    setTimeout(() => finish(exitCode), 30)
    return { output: () => text, kill: () => finish(null), finished }
  }
}

describe('github routes', () => {
  it('GET /github/connection — signed in, as whom', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger, githubConnection: signedInConnection() })
      const res = await app.request('/github/connection')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        isInstalled: true,
        isAuthenticated: true,
        accountLabel: 'chadnicely',
        inactiveReason: null,
      })
    })
  })

  it('GET /github/connection — not installed is an answer, not a 500', async () => {
    await withTestDatabase(async (db) => {
      const githubConnection = new GitHubConnection({
        runCommand: async () => {
          throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT', stdout: '', stderr: '' })
        },
      })
      const app = createApp({ db, logger: silentLogger, githubConnection })
      const res = await app.request('/github/connection')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { isInstalled: boolean; inactiveReason: string }
      expect(body.isInstalled).toBe(false)
      expect(body.inactiveReason).toContain('not installed')
    })
  })

  it('sign-in: the code + URL come back at once, the poll turns signed-in, cancel forgets it', async () => {
    await withTestDatabase(async (db) => {
      const githubConnection = new GitHubConnection({
        runCommand: async () => ({ stdout: '', stderr: '' }),
        spawnSignInProcess: scriptedSignIn(
          '! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: https://github.com/login/device\n',
          0,
        ),
      })
      const app = createApp({ db, logger: silentLogger, githubConnection })

      const began = await app.request('/github/connection/sign-in', { method: 'POST' })
      expect(began.status).toBe(200)
      const state = (await began.json()) as { loginId: string; phase: string; userCode: string; verificationUrl: string }
      expect(state.phase).toBe('awaiting-browser')
      expect(state.userCode).toBe('ABCD-1234')
      expect(state.verificationUrl).toBe('https://github.com/login/device')

      await new Promise((resolve) => setTimeout(resolve, 60))
      const polled = await app.request(`/github/connection/sign-in/${state.loginId}`)
      expect(((await polled.json()) as { phase: string }).phase).toBe('signed-in')

      const cancelled = await app.request(`/github/connection/sign-in/${state.loginId}`, {
        method: 'DELETE',
      })
      expect(cancelled.status).toBe(204)
      const gone = await app.request(`/github/connection/sign-in/${state.loginId}`)
      expect(gone.status).toBe(404)
    })
  })

  it('DELETE /github/connection signs the named account out — and is a no-op when nobody is in', async () => {
    await withTestDatabase(async (db) => {
      const calls: string[][] = []
      let signedIn = true
      const githubConnection = new GitHubConnection({
        runCommand: async (_file, args) => {
          calls.push(args)
          if (args[1] === 'status') {
            if (!signedIn) {
              throw Object.assign(new Error('exit 1'), {
                stdout: '',
                stderr: 'You are not logged into any GitHub hosts.',
              })
            }
            return { stdout: '', stderr: '✓ Logged in to github.com account chadnicely (keyring)' }
          }
          signedIn = false
          return { stdout: '', stderr: '' }
        },
      })
      const app = createApp({ db, logger: silentLogger, githubConnection })

      const res = await app.request('/github/connection', { method: 'DELETE' })
      expect(res.status).toBe(204)
      expect(calls).toEqual([
        ['auth', 'status'],
        ['auth', 'logout', '--hostname', 'github.com', '--user', 'chadnicely'],
      ])

      const again = await app.request('/github/connection', { method: 'DELETE' })
      expect(again.status).toBe(204)
      expect(calls).toHaveLength(3)
    })
  })
})
