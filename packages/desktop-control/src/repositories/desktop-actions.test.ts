import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import {
  listDesktopActions,
  listDesktopActionsForSession,
  listRecentDesktopActionsForSession,
  recordDesktopAction,
} from './desktop-actions.js'

const makeUser = () => {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

describe('desktop_actions repository', () => {
  it('appends an act and reads every column back', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const row = recordDesktopAction(db, {
        userId: user.id,
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        goal: 'check whether the containers are running',
        tool: 'launch_app',
        appName: 'Docker Desktop',
        detail: 'launched (launched)',
        outcome: 'ok',
      })
      expect(row.tool).toBe('launch_app')
      expect(row.appName).toBe('Docker Desktop')
      expect(row.goal).toBe('check whether the containers are running')
      expect(row.outcome).toBe('ok')
      expect(row.sessionId).toBe('sess-1')
      expect(row.workspaceId).toBe('ws-1')
      expect(row.id).toHaveLength(36)
    })
  })

  it('keeps every act — the same act twice is two rows, not one', async () => {
    // An append-only record: two identical clicks ARE two things that happened,
    // and collapsing them would misreport what the user's machine went through.
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const entry = {
        userId: user.id,
        tool: 'act_on_desktop',
        detail: 'clicked (10, 20)',
        outcome: 'unverified' as const,
      }
      recordDesktopAction(db, entry)
      recordDesktopAction(db, entry)
      expect(listDesktopActions(db, user.id)).toHaveLength(2)
    })
  })

  it('stores null for an act with no session or workspace — the global-root default', async () => {
    // A caller without a stable identity (or one outside any workspace) still
    // gets a user-level log; the columns stay honestly empty, never ''-filled.
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const row = recordDesktopAction(db, {
        userId: user.id,
        tool: 'act_on_desktop',
        detail: 'clicked (10, 20)',
        outcome: 'unverified',
      })
      expect(row.sessionId).toBeNull()
      expect(row.workspaceId).toBeNull()
    })
  })

  it('records a FAILED act as failed — the log is not a success story', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      recordDesktopAction(db, {
        userId: user.id,
        tool: 'act_on_app',
        appName: 'Notepad',
        detail: 'type_text on edit',
        outcome: 'failed',
        note: 'field reads ""',
      })
      const [row] = listDesktopActions(db, user.id)
      expect(row?.outcome).toBe('failed')
      expect(row?.note).toBe('field reads ""')
    })
  })

  it('scopes to the user — one machine, but never another account\'s acts', async () => {
    await withTestDatabase(async (db) => {
      const mine = insertUser(db, makeUser())
      const theirs = insertUser(db, makeUser())
      recordDesktopAction(db, { userId: theirs.id, tool: 'act_on_app', detail: 'x', outcome: 'ok' })
      expect(listDesktopActions(db, mine.id)).toEqual([])
    })
  })

  it('reads ONE task back in the order it happened', async () => {
    // "How far did it get" is a sequence, so it reads oldest-first — the order
    // a person retraces it in, and the opposite of the newest-first log read.
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      for (const detail of ['opened Chrome', 'typed the address', 'pressed enter']) {
        recordDesktopAction(db, {
          userId: user.id,
          sessionId: 'sess-1',
          tool: 'act_on_desktop',
          detail,
          outcome: 'unverified',
        })
      }
      recordDesktopAction(db, {
        userId: user.id,
        sessionId: 'other',
        tool: 'act_on_desktop',
        detail: 'unrelated',
        outcome: 'unverified',
      })
      const steps = listDesktopActionsForSession(db, user.id, 'sess-1')
      expect(steps.map((step) => step.detail)).toEqual([
        'opened Chrome',
        'typed the address',
        'pressed enter',
      ])
    })
  })

  it('reads the recent TAIL newest-first, bounded — the continuation prompt read', async () => {
    // A long-lived session (the global root) accumulates rows without bound;
    // the prompt only wants the end, so the read must cap and lead newest.
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      // No sleeps: rapid inserts land in the SAME millisecond on purpose — the
      // insertion-order tie-break is what keeps the order deterministic.
      for (let step = 0; step < 5; step += 1) {
        recordDesktopAction(db, {
          userId: user.id,
          sessionId: 'sess-1',
          tool: 'act_on_desktop',
          detail: `step ${step}`,
          outcome: 'unverified',
        })
      }
      const tail = listRecentDesktopActionsForSession(db, user.id, 'sess-1', 2)
      expect(tail.map((row) => row.detail)).toEqual(['step 4', 'step 3'])
    })
  })
})
