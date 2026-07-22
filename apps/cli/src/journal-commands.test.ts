import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { VynelClient } from '@vynel/sdk'
import { buildProgram } from './index.js'
import { localDayKey } from './day-flag.js'

// A stub client whose `journalUser` methods record their call args (and
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
    journalUser: {
      list: record('journalUser.list'),
      create: record('journalUser.create'),
      delete: record('journalUser.delete'),
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

describe('vynel journal', () => {
  it('list reads the journal via journalUser.list (no filter → no options arg)', async () => {
    const { client, calls } = stubClient()
    await run(client, ['journal', 'list'])
    expect(calls).toStrictEqual([{ method: 'journalUser.list', args: [] }])
  })

  it('list maps --date to the exact-day query', async () => {
    const { client, calls } = stubClient()
    await run(client, ['journal', 'list', '--date', '2026-07-23'])
    expect(calls).toStrictEqual([
      { method: 'journalUser.list', args: [{ entryDate: '2026-07-23' }] },
    ])
  })

  it('list maps --from/--to to the inclusive range query', async () => {
    const { client, calls } = stubClient()
    await run(client, ['journal', 'list', '--from', '2026-07-20', '--to', '2026-07-22'])
    expect(calls).toStrictEqual([
      { method: 'journalUser.list', args: [{ from: '2026-07-20', to: '2026-07-22' }] },
    ])
  })

  it("add without --date appends a GLOBAL entry for today (the user's clock)", async () => {
    const { client, calls } = stubClient()
    await run(client, ['journal', 'add', 'Shipped the pricing page.'])
    expect(calls).toStrictEqual([
      {
        method: 'journalUser.create',
        args: [
          { scope: 'global', entryDate: localDayKey(), content: 'Shipped the pricing page.' },
        ],
      },
    ])
  })

  it('add with --date and -w appends a WORKSPACE entry for that day', async () => {
    const { client, calls } = stubClient()
    await run(client, [
      'journal',
      'add',
      'Fixed the booking bug.',
      '--date',
      '2026-07-22',
      '-w',
      'ws_1',
    ])
    expect(calls).toStrictEqual([
      {
        method: 'journalUser.create',
        args: [
          {
            scope: 'workspace',
            workspaceId: 'ws_1',
            entryDate: '2026-07-22',
            content: 'Fixed the booking bug.',
          },
        ],
      },
    ])
  })

  it('delete removes the entry and confirms the id', async () => {
    const { client, calls } = stubClient()
    await run(client, ['journal', 'delete', 'j_1'])
    expect(calls).toStrictEqual([{ method: 'journalUser.delete', args: ['j_1'] }])
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ deleted: 'j_1' }, null, 2))
  })
})
