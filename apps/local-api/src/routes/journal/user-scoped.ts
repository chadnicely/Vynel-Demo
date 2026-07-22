// The USER-scoped `journal` HTTP surface — mounted at `/journal` (NO
// workspace prefix) from `apps/local-api/src/app.ts`, alongside the
// workspace-scoped twin (`/workspaces/:workspaceId/journal`). These routes
// span BOTH scopes: a user's GLOBAL (null-workspace) entries AND every
// workspace entry they own — the surface behind the journal panel and the
// CLI.
//
//   GET    /           -> listJournalEntriesForUser  [x-mcp: list_my_journal_entries]
//   POST   /           -> createJournalEntry (scope: global|workspace; source=user)
//   PATCH  /:entryId   -> updateJournalEntry
//   DELETE /:entryId   -> deleteJournalEntry (hard delete)
//
// THIS IS THE USER'S SURFACE: `POST /` hard-codes `source: 'user'` (the agent
// appends through its workspace-scoped door, which hard-codes 'assistant' —
// provenance is unspoofable by construction). Only the safe-read `GET /` is
// x-mcp exposed; edit and delete are panel/CLI-only — the assistant NEVER
// rewrites journal history (docs/module-notes/journal.md). The id-ops
// authorize by userId (the tenant boundary); not-found and not-owned both
// return an identical 404 (no enumeration leak).
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` → handler
// on `factory.createApp()`; handlers THROW typed VynelError subclasses (the
// app.ts onError maps them).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  createJournalEntry,
  deleteJournalEntry,
  listJournalEntriesForUser,
  updateJournalEntry,
} from '@vynel/journal'
import { serializeJournalEntryForResponse } from './serializers.js'
import {
  JournalEntryParamSchema,
  ListJournalEntriesQuerySchema,
  CreateJournalEntryForUserRequestSchema,
  UpdateJournalEntryRequestSchema,
  JournalEntryResponseSchema,
  ListJournalEntriesResponseSchema,
} from './schemas.js'

export const journalUserApp = factory
  .createApp()
  // GET / — every entry the user owns, both scopes (day/range filters).
  .get(
    '/',
    describeRoute({
      tags: ['journal'],
      summary: 'Read every journal entry the user owns — global + workspace.',
      'x-sdk-name': 'journalUser.list',
      responses: {
        200: {
          description: 'Array of JournalEntry.',
          content: { 'application/json': { schema: resolver(ListJournalEntriesResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_my_journal_entries',
        description:
          'Read every journal entry the user owns — both global (no workspace) and ' +
          'workspace-scoped, newest first. Each entry is a dated moment (`entryDate` YYYY-MM-DD ' +
          '+ prose content) recording what happened. Optional `entryDate` reads one exact day; ' +
          '`from`/`to` (inclusive) read a range; `limit` caps the count. Read-only.',
      },
    }),
    validator('query', ListJournalEntriesQuerySchema),
    ...userScoped,
    (c) => {
      const { entryDate, from, to, limit } = c.req.valid('query')
      const entries = listJournalEntriesForUser(c.var.db, {
        userId: c.var.user.id,
        ...(entryDate !== undefined ? { entryDate } : {}),
        ...(from !== undefined ? { fromDate: from } : {}),
        ...(to !== undefined ? { toDate: to } : {}),
        ...(limit !== undefined ? { limit } : {}),
      })
      return c.json(entries.map(serializeJournalEntryForResponse))
    },
  )
  // POST / — the USER's create door; scope picks global (null workspace) vs a workspace.
  .post(
    '/',
    describeRoute({
      tags: ['journal'],
      summary: 'Create a global or workspace journal entry (user provenance).',
      'x-sdk-name': 'journalUser.create',
      responses: {
        201: {
          description: 'Journal entry created.',
          content: { 'application/json': { schema: resolver(JournalEntryResponseSchema) } },
        },
        400: { description: 'Validation error, or workspaceId missing for a workspace scope.' },
      },
    }),
    validator('json', CreateJournalEntryForUserRequestSchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const entry = createJournalEntry(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: body.scope === 'global' ? null : body.workspaceId,
          entryDate: body.entryDate,
          content: body.content,
          source: 'user',
        },
        { logger: c.var.logger },
      )
      return c.json(serializeJournalEntryForResponse(entry), 201)
    },
  )
  // PATCH /:entryId — edit an entry the user owns (content, date).
  .patch(
    '/:entryId',
    describeRoute({
      tags: ['journal'],
      summary: 'Update a journal entry the user owns (content or date).',
      'x-sdk-name': 'journalUser.update',
      responses: {
        200: {
          description: 'Journal entry updated.',
          content: { 'application/json': { schema: resolver(JournalEntryResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'No such journal entry owned by this user.' },
      },
    }),
    validator('param', JournalEntryParamSchema),
    validator('json', UpdateJournalEntryRequestSchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const entry = updateJournalEntry(
        c.var.db,
        {
          entryId: c.req.valid('param').entryId,
          userId: c.var.user.id,
          ...(body.content !== undefined ? { content: body.content } : {}),
          ...(body.entryDate !== undefined ? { entryDate: body.entryDate } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeJournalEntryForResponse(entry))
    },
  )
  // DELETE /:entryId — remove an entry (hard delete; the user's call, never the agent's).
  .delete(
    '/:entryId',
    describeRoute({
      tags: ['journal'],
      summary: 'Delete a journal entry the user owns (hard delete).',
      'x-sdk-name': 'journalUser.delete',
      responses: {
        204: { description: 'Journal entry deleted.' },
        404: { description: 'No such journal entry owned by this user.' },
      },
    }),
    validator('param', JournalEntryParamSchema),
    ...userScoped,
    (c) => {
      deleteJournalEntry(
        c.var.db,
        { entryId: c.req.valid('param').entryId, userId: c.var.user.id },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )
