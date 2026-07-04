import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { VynelClient } from '@vynel/sdk'
import { buildProgram } from './index.js'

// A stub client whose `schedules` + `schedulesUser` methods record their call
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
    schedules: {
      list: record('schedules.list'),
      listTemplates: record('schedules.listTemplates'),
      listRuns: record('schedules.listRuns'),
      enable: record('schedules.enable'),
      disable: record('schedules.disable'),
      delete: record('schedules.delete'),
      fireNow: record('schedules.fireNow'),
    },
    schedulesUser: {
      list: record('schedulesUser.list'),
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

describe('vynel schedules', () => {
  it('list reads the workspace schedules via schedules.list', async () => {
    const { client, calls } = stubClient()
    await run(client, ['schedules', 'list', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'schedules.list', args: ['ws_1'] }])
  })

  it('mine reads all the user schedules via schedulesUser.list', async () => {
    const { client, calls } = stubClient()
    await run(client, ['schedules', 'mine'])
    expect(calls).toStrictEqual([{ method: 'schedulesUser.list', args: [] }])
  })

  it('templates reads via schedules.listTemplates', async () => {
    const { client, calls } = stubClient()
    await run(client, ['schedules', 'templates', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'schedules.listTemplates', args: ['ws_1'] }])
  })

  it('runs maps the limit flag to schedules.listRuns', async () => {
    const { client, calls } = stubClient()
    await run(client, ['schedules', 'runs', 'sch_1', '-w', 'ws_1', '-l', '5'])
    expect(calls).toStrictEqual([
      { method: 'schedules.listRuns', args: ['ws_1', 'sch_1', { limit: 5 }] },
    ])
  })

  it('runs omits the options arg when no limit is given', async () => {
    const { client, calls } = stubClient()
    await run(client, ['schedules', 'runs', 'sch_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'schedules.listRuns', args: ['ws_1', 'sch_1', undefined] }])
  })

  it('enable + disable pass the scheduleId + workspace', async () => {
    const { client, calls } = stubClient()
    await run(client, ['schedules', 'enable', 'sch_1', '-w', 'ws_1'])
    await run(client, ['schedules', 'disable', 'sch_2', '-w', 'ws_1'])
    expect(calls).toStrictEqual([
      { method: 'schedules.enable', args: ['ws_1', 'sch_1'] },
      { method: 'schedules.disable', args: ['ws_1', 'sch_2'] },
    ])
  })

  it('delete passes the scheduleId + workspace to schedules.delete', async () => {
    const { client, calls } = stubClient()
    await run(client, ['schedules', 'delete', 'sch_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'schedules.delete', args: ['ws_1', 'sch_1'] }])
  })

  it('fire-now passes the scheduleId + workspace to schedules.fireNow', async () => {
    const { client, calls } = stubClient()
    await run(client, ['schedules', 'fire-now', 'sch_1', '-w', 'ws_1'])
    expect(calls).toStrictEqual([{ method: 'schedules.fireNow', args: ['ws_1', 'sch_1'] }])
  })

  it('propagates an error thrown by a command action', async () => {
    const { client } = stubClient()
    ;(client.schedulesUser as unknown as { list: () => Promise<never> }).list = () =>
      Promise.reject(new Error('boom'))
    await expect(run(client, ['schedules', 'mine'])).rejects.toThrow('boom')
  })
})
