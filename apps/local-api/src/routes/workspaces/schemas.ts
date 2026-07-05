// Zod request/query schemas for the `workspaces` HTTP surface. Per
// `docs/blueprints/workspaces/blueprint.md §8.1`. API-internal — one
// consumer; promote to `@vynel/contracts` only on the second consumer
// per `.claude/rules/coding-standard.md` "Zod schemas".
//
// The kind enum is a deliberately-synced copy of the `WorkspaceKind`
// union (`workspaces/coding.md §3` names this file as one of the sync
// points — see also `@vynel/contracts/workspaces/workspace-kind-bundles`,
// which keeps its own copy for the frontend bundle).
//
// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `WorkspaceResponse` / `DirectoryListingResponse`
// from `@vynel/contracts/workspaces/workspace-http` (the type
// `serializeWorkspaceForResponse` and `listChildDirectories` are cast
// to). Declared here — not inverted to `z.infer` — because the
// canonical type lives in the shared contracts package, not in this
// route's serializer; the schema exists so `describeRoute` can attach
// a real OpenAPI response body via `resolver()`.

import { z } from 'zod'

const WorkspaceKindSchema = z.enum(['small-business', 'personal', 'project', 'custom'])

export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(120),
  // Optional — the user-facing kind picker was retired ("stop asking"); the
  // core defaults to 'personal'. The column stays NOT NULL (core-supplied).
  kind: WorkspaceKindSchema.optional(),
  // An EXISTING directory on disk to register as the workspace (2026-06-19).
  directory: z.string().min(1),
})

export const UpdateWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  // The workspace manager's persona name (brain-tree Ch5) — "Mark is handling vynel".
  managerName: z.string().min(1).max(60).optional(),
  // Continue-mode toggle (Slice 2). True = the landing conversation follows the
  // root + swaps invisibly before the context fills; false = classic per-topic
  // sessions. Default-on at the column level; this lets the user switch it off.
  continueEnabled: z.boolean().optional(),
})

export const DeleteWorkspaceRequestSchema = z.object({
  deleteFilesFromDisk: z.boolean(),
})

// Folder picker — `path` omitted starts at the user's home directory.
export const BrowseDirectoriesQuerySchema = z.object({
  path: z.string().optional(),
})

export const ListWorkspacesQuerySchema = z.object({
  includeArchived: z.coerce.boolean().optional(),
  // Defensive cap per coding-standard.md "Structure / patterns" — the
  // repo + core clamp identically (default 100, max 500).
  limit: z.coerce.number().int().positive().max(500).optional(),
})

export const WorkspaceResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  // Null on pre-persona rows (the UI resolves a default for display).
  managerName: z.string().nullable(),
  kind: WorkspaceKindSchema,
  path: z.string(),
  isArchived: z.boolean(),
  continueEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastAccessedAt: z.string(),
})

export const ListWorkspacesResponseSchema = z.array(WorkspaceResponseSchema)

const DirectoryEntryResponseSchema = z.object({
  name: z.string(),
  path: z.string(),
})

export const DirectoryListingResponseSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(DirectoryEntryResponseSchema),
  drives: z.array(z.string()),
})

export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequestSchema>
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequestSchema>
export type DeleteWorkspaceRequest = z.infer<typeof DeleteWorkspaceRequestSchema>
export type ListWorkspacesQuery = z.infer<typeof ListWorkspacesQuerySchema>
