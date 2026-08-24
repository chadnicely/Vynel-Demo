// Zod request/query schemas for `journal` routes. XxxSchema suffix;
// API-internal (single consumer) so they live beside the routes. Validated
// via `validator` from `hono-openapi/zod`. The content cap mirrors the core
// op's JOURNAL_CONTENT_MAX_LENGTH; the date shape mirrors ENTRY_DATE_PATTERN
// (the core op is the one home).

import { z } from 'zod'
import { ENTRY_DATE_PATTERN } from '@vynel/journal'

export const JournalEntryParamSchema = z.object({
  entryId: z.string().min(1),
})

const EntryDateSchema = z.string().regex(ENTRY_DATE_PATTERN, 'Use the YYYY-MM-DD format.')

export const ListJournalEntriesQuerySchema = z.object({
  entryDate: EntryDateSchema.optional(), // exact day — wins over the range
  from: EntryDateSchema.optional(), // inclusive
  to: EntryDateSchema.optional(), // inclusive
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

// The workspace-scoped `POST /` body — the AGENT's append door (the route
// hard-codes source='assistant'; there is no source field to spoof).
export const CreateJournalEntryRequestSchema = z.object({
  entryDate: EntryDateSchema,
  content: z.string().min(1).max(8000),
  sessionId: z.string().min(1).optional(),
  // The commit this entry records, when the work landed as one — the short
  // hash, capped at the core op's JOURNAL_COMMIT_REF_MAX_LENGTH.
  commit: z.string().min(1).max(64).optional(),
})

// The user-scoped `POST /journal` body — the PANEL/CLI create door (the route
// hard-codes source='user'). `scope` discriminates a GLOBAL entry (no
// workspace) from a WORKSPACE entry; the discriminated union makes
// `workspaceId` REQUIRED in the workspace branch (the tasksUser.create
// precedent).
const createEntryFields = {
  entryDate: EntryDateSchema,
  content: z.string().min(1).max(8000),
}

export const CreateJournalEntryForUserRequestSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global'), ...createEntryFields }),
  z.object({ scope: z.literal('workspace'), workspaceId: z.string().min(1), ...createEntryFields }),
])

export const UpdateJournalEntryRequestSchema = z.object({
  content: z.string().min(1).max(8000).optional(),
  entryDate: EntryDateSchema.optional(),
})

// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `JournalEntryResponse` from
// `@vynel/contracts/journal/journal-http` (the type
// `serializeJournalEntryForResponse` is cast to). Declared here — not
// inverted to `z.infer` — because the canonical type lives in contracts; the
// schema exists so `describeRoute` can attach a real OpenAPI response body
// via `resolver()` (the tasks precedent).

const JournalEntrySourceResponseSchema = z.enum(['assistant', 'user'])

export const JournalEntryResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  // Null = GLOBAL scope — a user-level entry with no workspace.
  workspaceId: z.string().nullable(),
  entryDate: z.string(), // YYYY-MM-DD
  content: z.string(),
  source: JournalEntrySourceResponseSchema,
  sessionId: z.string().nullable(),
  sessionTitle: z.string().nullable(),
  commitRef: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListJournalEntriesResponseSchema = z.array(JournalEntryResponseSchema)
