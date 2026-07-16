import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { VynelClient } from '@vynel/sdk'
import { buildProgram } from './index.js'

// A stub client whose `sshServers` methods record their call args (and
// resolve to a dummy result) — the apps-commands stub precedent.
function stubClient(): { client: VynelClient; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args })
      return Promise.resolve({ ok: true })
    }
  const client = {
    sshServers: {
      list: record('sshServers.list'),
      testConnection: record('sshServers.testConnection'),
      remove: record('sshServers.remove'),
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

describe('vynel ssh', () => {
  it('list reads the registered servers (zero-arg call)', async () => {
    const { client, calls } = stubClient()
    await run(client, ['ssh', 'list'])
    expect(calls).toStrictEqual([{ method: 'sshServers.list', args: [] }])
  })

  it('test maps to testConnection with the server id', async () => {
    const { client, calls } = stubClient()
    await run(client, ['ssh', 'test', 'srv_1'])
    expect(calls).toStrictEqual([{ method: 'sshServers.testConnection', args: ['srv_1'] }])
  })

  it('remove calls the route and confirms the id', async () => {
    const { client, calls } = stubClient()
    await run(client, ['ssh', 'remove', 'srv_1'])
    expect(calls).toStrictEqual([{ method: 'sshServers.remove', args: ['srv_1'] }])
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ removed: 'srv_1' }, null, 2))
  })

  it('has no add subcommand — secrets never ride a CLI flag', () => {
    const { client } = stubClient()
    const ssh = buildProgram(() => client).commands.find((command) => command.name() === 'ssh')
    expect(ssh?.commands.map((command) => command.name()).sort()).toEqual([
      'list',
      'remove',
      'test',
    ])
  })
})
