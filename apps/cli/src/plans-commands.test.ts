import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { VynelClient } from '@vynel/sdk'
import { buildProgram } from './index.js'
import { localDayKey, toDayKey } from './day-flag.js'

// A stub client whose `plansUser` methods record their call args (and resolve
// to a dummy result) — the tasks-commands stub precedent.
function stubClient(): { client: VynelClient; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args })
      return Promise.resolve({ ok: true })
    }
  const client = {
    plansUser: {
      list: record('plansUser.list'),
      create: record('plansUser.create'),
      update: record('plansUser.update'),
      delete: record('plansUser.delete'),
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

describe('vynel plans', () => {
  it('list reads every plan via plansUser.list (no filter → no options arg)', async () => {
    const { client, calls } = stubClient()
    await run(client, ['plans', 'list'])
    expect(calls).toStrictEqual([{ method: 'plansUser.list', args: [] }])
  })

  it('list maps the status + date flags to the query options', async () => {
    const { client, calls } = stubClient()
    await run(client, ['plans', 'list', '-s', 'done', '--date', '2026-07-23'])
    expect(calls).toStrictEqual([
      { method: 'plansUser.list', args: [{ status: 'done', planDate: '2026-07-23' }] },
    ])
  })

  it('the --date flag parser rejects malformed days before any client call', () => {
    // toDayKey is the one home every date-wise flag routes through
    // (plans --date, plans move, journal --date/--from/--to).
    for (const bad of ['tomorrow', '2026/07/23', '23-07-2026', '2026-7-3']) {
      expect(() => toDayKey(bad)).toThrow(/YYYY-MM-DD/)
    }
    expect(toDayKey('2026-07-23')).toBe('2026-07-23')
  })

  it("add without --date creates a GLOBAL plan for today (the user's clock)", async () => {
    const { client, calls } = stubClient()
    await run(client, ['plans', 'add', 'Bookkeeping day'])
    expect(calls).toStrictEqual([
      {
        method: 'plansUser.create',
        args: [{ scope: 'global', title: 'Bookkeeping day', planDate: localDayKey() }],
      },
    ])
  })

  it('add with --date, -w and -d creates a WORKSPACE plan with detail', async () => {
    const { client, calls } = stubClient()
    await run(client, [
      'plans',
      'add',
      'Launch day',
      '--date',
      '2026-08-01',
      '-w',
      'ws_1',
      '-d',
      'Newsletter + landing page',
    ])
    expect(calls).toStrictEqual([
      {
        method: 'plansUser.create',
        args: [
          {
            scope: 'workspace',
            workspaceId: 'ws_1',
            title: 'Launch day',
            planDate: '2026-08-01',
            detail: 'Newsletter + landing page',
          },
        ],
      },
    ])
  })

  it('done / reopen map to status patches', async () => {
    const { client, calls } = stubClient()
    await run(client, ['plans', 'done', 'p_1'])
    await run(client, ['plans', 'reopen', 'p_1'])
    expect(calls).toStrictEqual([
      { method: 'plansUser.update', args: ['p_1', { status: 'done' }] },
      { method: 'plansUser.update', args: ['p_1', { status: 'open' }] },
    ])
  })

  it('move patches the planDate', async () => {
    const { client, calls } = stubClient()
    await run(client, ['plans', 'move', 'p_1', '2026-08-02'])
    expect(calls).toStrictEqual([
      { method: 'plansUser.update', args: ['p_1', { planDate: '2026-08-02' }] },
    ])
  })

  it('delete removes the plan and confirms the id', async () => {
    const { client, calls } = stubClient()
    await run(client, ['plans', 'delete', 'p_1'])
    expect(calls).toStrictEqual([{ method: 'plansUser.delete', args: ['p_1'] }])
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ deleted: 'p_1' }, null, 2))
  })
})
