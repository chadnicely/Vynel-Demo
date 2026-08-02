import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { VynelClient } from '@vynel/sdk'
import { buildProgram } from './index.js'

// A stub client whose `skills` methods record their call args (and resolve to a
// dummy result). Lets us drive the real commander program + assert the args →
// SDK-call mapping, with no server and no process exit.
function stubClient(): { client: VynelClient; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args })
      return Promise.resolve({ ok: true })
    }
  const client = {
    skills: {
      listInstalled: record('listInstalled'),
      listInstalledResolved: record('listInstalledResolved'),
      listAvailable: record('listAvailable'),
      install: record('install'),
      uninstall: record('uninstall'),
      synchronize: record('synchronize'),
    },
  } as unknown as VynelClient
  return { client, calls }
}

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
afterEach(() => logSpy.mockClear())
afterAll(() => logSpy.mockRestore())

function run(client: VynelClient, argv: string[]): Promise<unknown> {
  return buildProgram(() => client).parseAsync(argv, { from: 'user' })
}

describe('vynel skills', () => {
  it('list reads via skills.listInstalled', async () => {
    const { client, calls } = stubClient()
    await run(client, ['skills', 'list', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'listInstalled', args: ['ws_1'] }])
  })

  // The owned/resolved split (2026-08-03) made the default narrower, so the old
  // answer needs a way to still be asked.
  it('list --resolved reads via skills.listInstalledResolved', async () => {
    const { client, calls } = stubClient()
    await run(client, ['skills', 'list', '-w', 'ws_1', '--resolved'])
    expect(calls).toStrictEqual([{ method: 'listInstalledResolved', args: ['ws_1'] }])
  })

  it('available reads via skills.listAvailable', async () => {
    const { client, calls } = stubClient()
    await run(client, ['skills', 'available', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'listAvailable', args: ['ws_1'] }])
  })

  it('install maps skillId + scope to skills.install', async () => {
    const { client, calls } = stubClient()
    await run(client, ['skills', 'install', 'skill_1', '-w', 'ws_1', '--scope', 'workspace'])
    expect(calls).toStrictEqual([
      { method: 'install', args: ['ws_1', { skillId: 'skill_1', scope: 'workspace' }] },
    ])
  })

  it('uninstall passes the installedSkillId + workspace positionally', async () => {
    const { client, calls } = stubClient()
    await run(client, ['skills', 'uninstall', 'inst_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'uninstall', args: ['ws_1', 'inst_1'] }])
  })

  it('synchronize passes just the workspace', async () => {
    const { client, calls } = stubClient()
    await run(client, ['skills', 'synchronize', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'synchronize', args: ['ws_1'] }])
  })

  it('propagates an error thrown by a command action', async () => {
    const { client } = stubClient()
    ;(client.skills as unknown as { synchronize: () => Promise<never> }).synchronize = () =>
      Promise.reject(new Error('boom'))
    await expect(run(client, ['skills', 'synchronize', '-w', 'ws_1'])).rejects.toThrow('boom')
  })
})
