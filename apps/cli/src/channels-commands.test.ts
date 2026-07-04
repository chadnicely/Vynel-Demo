import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { VynelClient } from '@vynel/sdk'
import { buildProgram } from './index.js'

// A stub client whose `channels` + `channelsUser` methods record their call
// args (and resolve to a dummy result). Lets us drive the real commander program
// + assert the args → SDK-call mapping, with no server and no process exit.
function stubClient(): { client: VynelClient; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args })
      return Promise.resolve({ ok: true })
    }
  const client = {
    channels: {
      list: record('channels.list'),
      listAllowedSenders: record('channels.listAllowedSenders'),
      enable: record('channels.enable'),
      disable: record('channels.disable'),
      disconnect: record('channels.disconnect'),
    },
    channelsUser: {
      list: record('channelsUser.list'),
      get: record('channelsUser.get'),
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

describe('vynel channels', () => {
  it('list reads the workspace channels via channels.list', async () => {
    const { client, calls } = stubClient()
    await run(client, ['channels', 'list', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'channels.list', args: ['ws_1'] }])
  })

  it('mine reads all the user channels via channelsUser.list', async () => {
    const { client, calls } = stubClient()
    await run(client, ['channels', 'mine'])
    expect(calls).toStrictEqual([{ method: 'channelsUser.list', args: [] }])
  })

  it('get reads one channel via channelsUser.get (user-scoped, no workspace)', async () => {
    const { client, calls } = stubClient()
    await run(client, ['channels', 'get', 'ch_1'])
    expect(calls).toStrictEqual([{ method: 'channelsUser.get', args: ['ch_1'] }])
  })

  it('allowed-senders reads via channels.listAllowedSenders', async () => {
    const { client, calls } = stubClient()
    await run(client, ['channels', 'allowed-senders', 'ch_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'channels.listAllowedSenders', args: ['ws_1', 'ch_1'] }])
  })

  it('enable + disable pass the channelId + workspace', async () => {
    const { client, calls } = stubClient()
    await run(client, ['channels', 'enable', 'ch_1', '-w', 'ws_1'])
    await run(client, ['channels', 'disable', 'ch_2', '-w', 'ws_1'])
    expect(calls).toStrictEqual([
      { method: 'channels.enable', args: ['ws_1', 'ch_1'] },
      { method: 'channels.disable', args: ['ws_1', 'ch_2'] },
    ])
  })

  it('disconnect passes the channelId + workspace to channels.disconnect', async () => {
    const { client, calls } = stubClient()
    await run(client, ['channels', 'disconnect', 'ch_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'channels.disconnect', args: ['ws_1', 'ch_1'] }])
  })

  it('propagates an error thrown by a command action', async () => {
    const { client } = stubClient()
    ;(client.channelsUser as unknown as { list: () => Promise<never> }).list = () =>
      Promise.reject(new Error('boom'))
    await expect(run(client, ['channels', 'mine'])).rejects.toThrow('boom')
  })
})
