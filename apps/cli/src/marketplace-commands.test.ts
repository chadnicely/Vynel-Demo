import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { VynelClient } from '@vynel/sdk'
import { buildProgram } from './index.js'

// A stub client whose `marketplace` methods record their call args (and resolve
// to a dummy result). The marketplace surface is read-only, so both commands are
// reads. Drives the real commander program with no server and no process exit.
function stubClient(): { client: VynelClient; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args })
      return Promise.resolve({ ok: true })
    }
  const client = {
    marketplace: {
      listItems: record('listItems'),
      getItem: record('getItem'),
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

describe('vynel marketplace', () => {
  it('list reads via marketplace.listItems', async () => {
    const { client, calls } = stubClient()
    await run(client, ['marketplace', 'list', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'listItems', args: ['ws_1'] }])
  })

  it('get passes the itemId + workspace positionally', async () => {
    const { client, calls } = stubClient()
    await run(client, ['marketplace', 'get', 'item_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'getItem', args: ['ws_1', 'item_1'] }])
  })

  it('propagates an error thrown by a command action', async () => {
    const { client } = stubClient()
    ;(client.marketplace as unknown as { listItems: () => Promise<never> }).listItems = () =>
      Promise.reject(new Error('boom'))
    await expect(run(client, ['marketplace', 'list', '-w', 'ws_1'])).rejects.toThrow('boom')
  })
})
