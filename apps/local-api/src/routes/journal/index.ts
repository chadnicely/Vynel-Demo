// The workspace-scoped `journal` HTTP surface — mounted under
// `/workspaces/:workspaceId/journal` from `apps/local-api/src/app.ts`:
//
//   GET    /  -> listJournalEntries                    [x-mcp]
//   POST   /  -> createJournalEntry (source=assistant) [x-mcp, mutatingApproved]
//
// THIS IS THE AGENT'S SURFACE, and it is deliberately APPEND + READ ONLY —
// the journal is the daily record the assistant reads to understand the flow
// of recent work; rewriting history is the user's call, never the
// assistant's (docs/module-notes/journal.md). The user's edit/delete doors
// live on the user-scoped twin (`/journal`, source='user'). `POST /`
// hard-codes `source: 'assistant'` (no body field to spoof). The `journal.*`
// SDK namespace exists as a generation artifact — app surfaces use
// `journalUser.*`.
//
// The append is UNCARDED (mutatingApproved, like task writes): low-stakes,
// fully visible, trivially reversible by the user.
//
// Locked Hono protocol: describeRoute → validator → `...workspaceScoped` →
// handler on `factory.createApp()`; handlers THROW typed VynelError
// subclasses (the app.ts onError maps them).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { createJournalEntry, listJournalEntries } from '@vynel/journal'
import {
  resolveJournalSessionTitle,
  serializeJournalEntryForResponse,
} from './serializers.js'
import {
  TURN_SESSION_HEADER,
  resolveOwnedTurnSessionId,
} from '../../sessions/turn-session-header.js'
import {
  ListJournalEntriesQuerySchema,
  CreateJournalEntryRequestSchema,
  JournalEntryResponseSchema,
  ListJournalEntriesResponseSchema,
} from './schemas.js'

export const journalApp = factory
  .createApp()
  // GET / — read the workspace's journal (owner-scoped; day/range filters).
  .get(
    '/',
    describeRoute({
      tags: ['journal'],
      summary: "Read the active workspace's journal (owner-scoped).",
      'x-sdk-name': 'journal.list',
      responses: {
        200: {
          description: 'Array of JournalEntry.',
          content: { 'application/json': { schema: resolver(ListJournalEntriesResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_journal_entries',
        description:
          "Read the workspace's daily work journal, newest first. Each entry is a dated moment " +
          '(`entryDate` YYYY-MM-DD + prose content) recording what happened and what was ' +
          'decided. Read recent entries when picking work back up to understand the flow of the ' +
          'last days. Optional `entryDate` reads one exact day; `from`/`to` (inclusive) read a ' +
          'range; `limit` caps the count (default 100). Read-only.',
      },
    }),
    validator('query', ListJournalEntriesQuerySchema),
    ...workspaceScoped,
    (c) => {
      const { entryDate, from, to, limit } = c.req.valid('query')
      const entries = listJournalEntries(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        ...(entryDate !== undefined ? { entryDate } : {}),
        ...(from !== undefined ? { fromDate: from } : {}),
        ...(to !== undefined ? { toDate: to } : {}),
        ...(limit !== undefined ? { limit } : {}),
      })
      return c.json(
        entries.map((entry) =>
          serializeJournalEntryForResponse(
            entry,
            resolveJournalSessionTitle(c.var.db, c.var.user.id, entry.sessionId),
          ),
        ),
      )
    },
  )
  // POST / — the AGENT's append door (source is hard-coded 'assistant').
  .post(
    '/',
    describeRoute({
      tags: ['journal'],
      summary: "Append an entry to the active workspace's journal (assistant provenance).",
      'x-sdk-name': 'journal.create',
      responses: {
        201: {
          description: 'Journal entry created.',
          content: { 'application/json': { schema: resolver(JournalEntryResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'add_journal_entry',
        description:
          'Append a dated entry to the daily work journal when meaningful work lands — what ' +
          'happened, what was decided, and anything the next session needs to know, in plain ' +
          'language the user recognizes. `entryDate` is the day it belongs to (YYYY-MM-DD, ' +
          "usually today); `content` is the entry (≤8000 chars). When the work landed as a " +
          'commit, pass `commit` (the short hash) so the entry points at it. Entries are ' +
          'attributed to YOUR session automatically — the user can open the session from the ' +
          'journal to see what was done. The journal is append-only for ' +
          'you — you cannot edit or remove entries, so write them as a faithful record, not a ' +
          'draft. Do not narrate the bookkeeping. Side effect: the entry appears in the ' +
          "user's journal.",
        mutatingApproved: true,
      },
    }),
    validator('json', CreateJournalEntryRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      // Attribution is server-stamped from the turn's ambient session header
      // (the tasks precedent) — the model cannot forget it or name another
      // session. The body field stays as the explicit fallback for callers
      // with no turn (none today pass it).
      const turnSessionId =
        resolveOwnedTurnSessionId(
          c.var.db,
          c.var.user.id,
          c.req.header(TURN_SESSION_HEADER),
        ) ?? body.sessionId
      const entry = createJournalEntry(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
          entryDate: body.entryDate,
          content: body.content,
          source: 'assistant',
          ...(turnSessionId !== undefined ? { sessionId: turnSessionId } : {}),
          ...(body.commit !== undefined ? { commitRef: body.commit } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(
        serializeJournalEntryForResponse(
          entry,
          resolveJournalSessionTitle(c.var.db, c.var.user.id, entry.sessionId),
        ),
        201,
      )
    },
  )
