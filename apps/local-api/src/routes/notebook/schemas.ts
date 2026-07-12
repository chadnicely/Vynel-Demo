// Zod request + response schemas for the `notebook` HTTP surface. XxxSchema
// suffix; API-internal (single consumer = apps/web) lives here under the route
// folder per `coding-standard.md` "Zod schemas" — promote to
// `@vynel/contracts/notebook/*` on the second consumer.

import { z } from 'zod'

const InstructionScopeSchema = z.enum(['global', 'workspace'])

// Length caps mirror @vynel/instructions' validate-instruction-document
// (the core re-validates; this bounds the wire).
const TitleSchema = z.string().min(1).max(120)
const BodySchema = z.string().min(1).max(50_000)

// A workspace turn's shelf view sees global + that workspace's books; omit
// for the global-root view (global books only).
export const PlaybookShelfQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
})

export const PlaybookParamSchema = z.object({
  playbookId: z.string().min(1),
})

export const NotebookDocumentParamSchema = z.object({
  documentId: z.string().min(1),
})

export const CreateNotebookDocumentBodySchema = z.object({
  scope: InstructionScopeSchema,
  // Required when scope is 'workspace'; must be absent for 'global' — the
  // core op enforces the pairing (400) and the workspace's existence (404).
  workspaceId: z.string().min(1).optional(),
  title: TitleSchema,
  body: BodySchema,
  enabled: z.boolean().optional(),
})

export const UpdateNotebookDocumentBodySchema = z.object({
  title: TitleSchema.optional(),
  body: BodySchema.optional(),
  enabled: z.boolean().optional(),
})

// ── Response schemas ────────────────────────────────────────────────
// The serialized shapes each route returns; `serializers.ts` derives its
// return types from these via `z.infer` (one source of truth per shape).

export const PlaybookListingSchema = z.object({
  id: z.string(),
  title: z.string(),
  oneLiner: z.string(),
  verified: z.boolean(),
})

export const PlaybookSchema = PlaybookListingSchema.extend({
  body: z.string(),
})

export const ListPlaybooksResponseSchema = z.object({
  playbooks: z.array(PlaybookListingSchema),
})

export const NotebookDocumentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  scope: InstructionScopeSchema,
  workspaceId: z.string().nullable(),
  mode: z.enum(['always', 'notebook']),
  title: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListNotebookDocumentsResponseSchema = z.object({
  documents: z.array(NotebookDocumentSchema),
})
