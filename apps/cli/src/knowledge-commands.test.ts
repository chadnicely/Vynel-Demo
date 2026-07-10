import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { VynelClient } from '@vynel/sdk'
import { buildProgram } from './index.js'

// A stub client whose `knowledge` methods record their call args (and
// resolve to a dummy result). Lets us drive the real commander program +
// assert the args → SDK-call mapping, with no server and no process exit.
function stubClient(): { client: VynelClient; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args })
      return Promise.resolve({ ok: true })
    }
  const client = {
    knowledge: {
      search: record('search'),
      listDocuments: record('listDocuments'),
      getDocument: record('getDocument'),
      getStatus: record('getStatus'),
      reindex: record('reindex'),
      addSource: record('addSource'),
      listSources: record('listSources'),
      removeSource: record('removeSource'),
    },
  } as unknown as VynelClient
  return { client, calls }
}

// The command actions print their result via console.log — keep stdout quiet.
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
afterEach(() => logSpy.mockClear())
afterAll(() => logSpy.mockRestore())

function run(client: VynelClient, argv: string[]): Promise<unknown> {
  return buildProgram(() => client).parseAsync(argv, { from: 'user' })
}

describe('vynel knowledge', () => {
  it('search maps the query + flags to knowledge.search', async () => {
    const { client, calls } = stubClient()
    await run(client, ['knowledge', 'search', 'hello', '-w', 'ws_1', '-m', 'hybrid', '-l', '5'])
    expect(calls).toStrictEqual([
      { method: 'search', args: ['ws_1', { query: 'hello', mode: 'hybrid', limit: 5 }] },
    ])
  })

  it('search omits absent optional flags (no undefined keys)', async () => {
    const { client, calls } = stubClient()
    await run(client, ['knowledge', 'search', 'hi', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'search', args: ['ws_1', { query: 'hi' }] }])
  })

  it('list maps kind + limit to knowledge.listDocuments', async () => {
    const { client, calls } = stubClient()
    await run(client, ['knowledge', 'list', '-w', 'ws_1', '-k', 'markdown', '-l', '10'])
    expect(calls).toStrictEqual([
      { method: 'listDocuments', args: ['ws_1', { documentKind: 'markdown', limit: 10 }] },
    ])
  })

  it('get passes the documentId + workspace positionally', async () => {
    const { client, calls } = stubClient()
    await run(client, ['knowledge', 'get', 'doc_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'getDocument', args: ['ws_1', 'doc_1'] }])
  })

  it('status + reindex pass just the workspace', async () => {
    const { client, calls } = stubClient()
    await run(client, ['knowledge', 'status', '-w', 'ws_1'])
    await run(client, ['knowledge', 'reindex', '-w', 'ws_1'])
    expect(calls).toStrictEqual([
      { method: 'getStatus', args: ['ws_1'] },
      { method: 'reindex', args: ['ws_1'] },
    ])
  })

  it('add-directory maps path to absolutePath + defaults scope to workspace', async () => {
    const { client, calls } = stubClient()
    await run(client, ['knowledge', 'add-directory', '/tmp/docs', '-w', 'ws_1'])
    expect(calls).toStrictEqual([
      { method: 'addSource', args: ['ws_1', { absolutePath: '/tmp/docs', scope: 'workspace' }] },
    ])
  })

  it('add-directory --global sets scope to global', async () => {
    const { client, calls } = stubClient()
    await run(client, ['knowledge', 'add-directory', '/tmp/docs', '-w', 'ws_1', '--global'])
    expect(calls).toStrictEqual([
      { method: 'addSource', args: ['ws_1', { absolutePath: '/tmp/docs', scope: 'global' }] },
    ])
  })

  it('sources lists via knowledge.listSources', async () => {
    const { client, calls } = stubClient()
    await run(client, ['knowledge', 'sources', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'listSources', args: ['ws_1'] }])
  })

  it('remove-source passes sourceId + workspace positionally', async () => {
    const { client, calls } = stubClient()
    await run(client, ['knowledge', 'remove-source', 'src_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'removeSource', args: ['ws_1', 'src_1'] }])
  })

  it('propagates an error thrown by a command action', async () => {
    const { client } = stubClient()
    ;(client.knowledge as unknown as { getStatus: () => Promise<never> }).getStatus = () =>
      Promise.reject(new Error('boom'))
    await expect(run(client, ['knowledge', 'status', '-w', 'ws_1'])).rejects.toThrow('boom')
  })
})
