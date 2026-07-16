import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { VynelClient } from '@vynel/sdk'
import { buildProgram } from './index.js'

// A stub client whose `workspaceApps` methods record their call args (and
// resolve to a dummy result) — the tasks-commands stub precedent.
function stubClient(): { client: VynelClient; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args })
      return Promise.resolve({ ok: true })
    }
  const client = {
    workspaceApps: {
      list: record('workspaceApps.list'),
      add: record('workspaceApps.add'),
      start: record('workspaceApps.start'),
      stop: record('workspaceApps.stop'),
      logs: record('workspaceApps.logs'),
      remove: record('workspaceApps.remove'),
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

describe('vynel apps', () => {
  it('list reads the workspace apps', async () => {
    const { client, calls } = stubClient()
    await run(client, ['apps', 'list', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'workspaceApps.list', args: ['ws_1'] }])
  })

  it('add maps name/command/dir/port', async () => {
    const { client, calls } = stubClient()
    await run(client, [
      'apps', 'add', 'Web app', '-w', 'ws_1', '-c', 'pnpm dev', '-d', 'apps/web', '-p', '8999',
    ])
    expect(calls).toStrictEqual([
      {
        method: 'workspaceApps.add',
        args: ['ws_1', { name: 'Web app', command: 'pnpm dev', cwdRelative: 'apps/web', port: 8999 }],
      },
    ])
  })

  it('start + stop map to their routes', async () => {
    const { client, calls } = stubClient()
    await run(client, ['apps', 'start', 'app_1', '-w', 'ws_1'])
    await run(client, ['apps', 'stop', 'app_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([
      { method: 'workspaceApps.start', args: ['ws_1', 'app_1'] },
      { method: 'workspaceApps.stop', args: ['ws_1', 'app_1'] },
    ])
  })

  it('logs maps the tail flag (and omits options without it)', async () => {
    const { client, calls } = stubClient()
    await run(client, ['apps', 'logs', 'app_1', '-w', 'ws_1', '-t', '50'])
    await run(client, ['apps', 'logs', 'app_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([
      { method: 'workspaceApps.logs', args: ['ws_1', 'app_1', { tail: 50 }] },
      { method: 'workspaceApps.logs', args: ['ws_1', 'app_1'] },
    ])
  })

  it('remove calls the route and confirms the id', async () => {
    const { client, calls } = stubClient()
    await run(client, ['apps', 'remove', 'app_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'workspaceApps.remove', args: ['ws_1', 'app_1'] }])
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ removed: 'app_1' }, null, 2))
  })
})
