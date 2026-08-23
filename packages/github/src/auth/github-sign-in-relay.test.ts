// The sign-in relay over a scripted fake of `gh auth login --web`: the code +
// URL surface as soon as gh prints them, the verdict follows the exit code,
// and a CLI that never offers a code fails in words — the real CLI is never
// spawned here.

import { describe, expect, it } from 'vitest'
import { NotFoundError } from '@vynel/errors'
import { GitHubSignInRelay, type GitHubSignInProcess } from './github-sign-in-relay.js'

function scriptedProcess(script: {
  printAfterMs?: number
  text?: string
  exitCode: number | null
  exitAfterMs?: number
}) {
  let output = ''
  let killed = false
  let finish: (code: number | null) => void = () => {}
  const finished = new Promise<number | null>((resolve) => {
    finish = resolve
  })
  if (script.text !== undefined) {
    setTimeout(() => {
      output += script.text ?? ''
    }, script.printAfterMs ?? 0)
  }
  if (script.exitAfterMs !== undefined) {
    setTimeout(() => finish(script.exitCode), script.exitAfterMs)
  }
  const process: GitHubSignInProcess = {
    output: () => output,
    kill: () => {
      killed = true
      finish(null)
    },
    finished,
  }
  return { process, wasKilled: () => killed, finish }
}

const GH_OUTPUT =
  '! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: https://github.com/login/device\n'

describe('GitHubSignInRelay', () => {
  it('surfaces the one-time code and the device URL, then signs in on exit 0', async () => {
    const scripted = scriptedProcess({ text: GH_OUTPUT, printAfterMs: 20, exitCode: 0 })
    const relay = new GitHubSignInRelay({ spawnSignInProcess: () => scripted.process })

    const began = await relay.begin()
    expect(began.phase).toBe('awaiting-browser')
    expect(began.userCode).toBe('ABCD-1234')
    expect(began.verificationUrl).toBe('https://github.com/login/device')

    scripted.finish(0)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(relay.get(began.loginId).phase).toBe('signed-in')
  })

  it("a non-zero exit fails with gh's last meaningful line, not the transcript", async () => {
    const scripted = scriptedProcess({
      text: `${GH_OUTPUT}error: device code expired\n`,
      exitCode: 1,
    })
    const relay = new GitHubSignInRelay({ spawnSignInProcess: () => scripted.process })
    const began = await relay.begin()
    scripted.finish(1)
    await new Promise((resolve) => setTimeout(resolve, 10))

    const state = relay.get(began.loginId)
    expect(state.phase).toBe('failed')
    expect(state.errorMessage).toBe('error: device code expired')
  })

  it('a CLI that exits before any code is a failure in words — "not installed" rides its output', async () => {
    const scripted = scriptedProcess({
      text: 'The GitHub CLI (gh) is not installed\n',
      exitCode: null,
      exitAfterMs: 5,
    })
    const relay = new GitHubSignInRelay({ spawnSignInProcess: () => scripted.process })
    const began = await relay.begin()
    expect(began.phase).toBe('failed')
    expect(began.errorMessage).toContain('not installed')
  })

  it('a second begin abandons a sign-in still waiting on the browser', async () => {
    const first = scriptedProcess({ text: GH_OUTPUT, exitCode: 0 })
    const second = scriptedProcess({ text: GH_OUTPUT, exitCode: 0 })
    const processes = [first.process, second.process]
    const relay = new GitHubSignInRelay({ spawnSignInProcess: () => processes.shift()! })

    const one = await relay.begin()
    const two = await relay.begin()
    expect(first.wasKilled()).toBe(true)
    expect(() => relay.get(one.loginId)).toThrow(NotFoundError)
    expect(relay.get(two.loginId).phase).toBe('awaiting-browser')
  })

  it('discard kills a sign-in still waiting on the browser and forgets it', async () => {
    const scripted = scriptedProcess({ text: GH_OUTPUT, exitCode: 0 })
    const relay = new GitHubSignInRelay({ spawnSignInProcess: () => scripted.process })
    const began = await relay.begin()

    relay.discard(began.loginId)
    expect(scripted.wasKilled()).toBe(true)
    expect(() => relay.get(began.loginId)).toThrow(NotFoundError)
  })
})
