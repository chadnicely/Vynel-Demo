// The scope decision itself, in isolation — `route-as-chat-turn.test.ts` pins
// what the pipeline DOES with each answer.

import { describe, it, expect } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { workspaces } from '@vynel/db/schema/workspaces'
import { seedChannel, makeUser, makeWorkspace } from '../test-support.js'
import { resolveChannelTurnScope } from './resolve-channel-turn-scope.js'
import type { StructuralLogger } from '../channels-types.js'

const silent: StructuralLogger = { info: () => {}, warn: () => {}, error: () => {} }

describe('resolveChannelTurnScope', () => {
  it('answers the channel’s own workspace, with the path the turn is addressed by', async () => {
    await withTestDatabase(async (db) => {
      const { channel, workspace } = seedChannel(db)

      expect(resolveChannelTurnScope(db, { channel, canRunWorkspaceTurn: true }, { logger: silent }))
        .toEqual({ kind: 'workspace', workspaceId: workspace.id, workspacePath: workspace.path, workspaceName: workspace.name })
    })
  })

  it('answers global for a channel with no workspace', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db, { workspaceId: null })

      expect(
        resolveChannelTurnScope(db, { channel, canRunWorkspaceTurn: true }, { logger: silent }),
      ).toEqual({ kind: 'global' })
    })
  })

  it('answers global — and warns — when the bound workspace is gone or not owned', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      // The FK cascades a workspace delete onto its channels, so the dangling
      // state this branch defends needs the constraint stood down to reproduce.
      db.run(sql`PRAGMA foreign_keys = OFF`)
      db.delete(workspaces).where(eq(workspaces.id, channel.workspaceId!)).run()
      db.run(sql`PRAGMA foreign_keys = ON`)
      const warnings: string[] = []
      const logger: StructuralLogger = { ...silent, warn: (_o, message) => warnings.push(message ?? '') }

      expect(resolveChannelTurnScope(db, { channel, canRunWorkspaceTurn: true }, { logger })).toEqual(
        { kind: 'global' },
      )
      expect(warnings).toHaveLength(1)

      // The not-owned half answers the same way — one answer, no enumeration.
      const stranger = insertUser(db, makeUser())
      const theirs = insertWorkspace(db, makeWorkspace(stranger.id))
      expect(
        resolveChannelTurnScope(
          db,
          { channel: { ...channel, workspaceId: theirs.id }, canRunWorkspaceTurn: true },
          { logger },
        ),
      ).toEqual({ kind: 'global' })
      expect(warnings).toHaveLength(2)
    })
  })

  it('stays global when the consumer wired no workspace runner', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)

      expect(
        resolveChannelTurnScope(db, { channel, canRunWorkspaceTurn: false }, { logger: silent }),
      ).toEqual({ kind: 'global' })
    })
  })
})
