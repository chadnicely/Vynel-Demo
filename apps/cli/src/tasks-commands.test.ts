import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { VynelClient } from '@vynel/sdk'
import { buildProgram } from './index.js'

// A stub client whose `tasksUser` methods record their call args (and resolve
// to a dummy result) — the schedules-commands stub precedent.
function stubClient(): { client: VynelClient; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args })
      return Promise.resolve({ ok: true })
    }
  const client = {
    tasksUser: {
      list: record('tasksUser.list'),
      create: record('tasksUser.create'),
      update: record('tasksUser.update'),
      delete: record('tasksUser.delete'),
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

describe('vynel tasks', () => {
  it('list reads every task via tasksUser.list (no filter → no options arg)', async () => {
    const { client, calls } = stubClient()
    await run(client, ['tasks', 'list'])
    expect(calls).toStrictEqual([{ method: 'tasksUser.list', args: [] }])
  })

  it('list maps the status flag to the query options', async () => {
    const { client, calls } = stubClient()
    await run(client, ['tasks', 'list', '-s', 'done'])
    expect(calls).toStrictEqual([{ method: 'tasksUser.list', args: [{ status: 'done' }] }])
  })

  it('add without -w creates a GLOBAL task', async () => {
    const { client, calls } = stubClient()
    await run(client, ['tasks', 'add', 'Water the plants'])
    expect(calls).toStrictEqual([
      { method: 'tasksUser.create', args: [{ scope: 'global', title: 'Water the plants' }] },
    ])
  })

  it('add with -w and -d creates a WORKSPACE task with detail', async () => {
    const { client, calls } = stubClient()
    await run(client, ['tasks', 'add', 'Draft newsletter', '-w', 'ws_1', '-d', 'Spring menu'])
    expect(calls).toStrictEqual([
      {
        method: 'tasksUser.create',
        args: [
          { scope: 'workspace', workspaceId: 'ws_1', title: 'Draft newsletter', detail: 'Spring menu' },
        ],
      },
    ])
  })

  it('done + reopen map to status updates', async () => {
    const { client, calls } = stubClient()
    await run(client, ['tasks', 'done', 'task_1'])
    await run(client, ['tasks', 'reopen', 'task_1'])
    expect(calls).toStrictEqual([
      { method: 'tasksUser.update', args: ['task_1', { status: 'done' }] },
      { method: 'tasksUser.update', args: ['task_1', { status: 'open' }] },
    ])
  })

  it('delete calls tasksUser.delete and confirms the id', async () => {
    const { client, calls } = stubClient()
    await run(client, ['tasks', 'delete', 'task_1'])
    expect(calls).toStrictEqual([{ method: 'tasksUser.delete', args: ['task_1'] }])
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ deleted: 'task_1' }, null, 2))
  })
})
