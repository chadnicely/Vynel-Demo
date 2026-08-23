// Zod schemas for the workspace wizard routes (api-internal — one consumer).

import { z } from 'zod'
import { WorkspaceResponseSchema } from './schemas.js'

/** The folder the user chose on screen 1 — the workspace folder itself
 *  (Kafi, 2026-08-23: never a child minted from the name). Before Finish it
 *  grounds the one-shot dispatch (the cwd); nothing is written there by a
 *  read, though its own Claude Code settings / CLAUDE.md load as for any
 *  workspace. */
const DirectorySchema = z.string().min(1).max(4_096)

export const StudyRivalSiteRequestSchema = z.object({
  /** The site as the user typed it — "opentable.com" (the UI's own floor). */
  site: z.string().trim().min(4).max(200),
  /** The user's idea, so the study is about THEIR angle on the site. */
  idea: z.string().min(1).max(5_000),
  directory: DirectorySchema,
})

const RivalSiteStudySchema = z.object({
  whatTheyDo: z.array(z.string()),
  leaveOut: z.array(z.string()),
  magic: z.array(z.object({ title: z.string(), why: z.string() })),
})

// Null = the provider could not study the site; the screen says so plainly.
export const StudyRivalSiteResponseSchema = z.object({
  study: RivalSiteStudySchema.nullable(),
})

// The answers every plan-shaped call carries — the synthesis reads them, the
// scaffold stores them (+ the stack screen's advanced notes, brief-only).
const AnswerFields = {
  idea: z.string().min(1).max(5_000),
  audience: z.string().min(1).max(200),
  firstThing: z.string().min(1).max(1_000),
  signIn: z.string().min(1).max(200),
  where: z.string().min(1).max(200),
  remembers: z.array(z.string().max(200)).max(20),
  wants: z.array(z.object({ text: z.string().max(500), from: z.string().max(200) })).max(80),
  leftOut: z.array(z.string().max(500)).max(40),
  changeRequests: z.array(z.string().max(2_000)).max(20),
  goalNotes: z.array(z.string().max(2_000)).max(20),
  stack: z.object({
    front: z.string().max(200),
    back: z.string().max(200),
    database: z.string().max(200),
  }),
}

export const SynthesizeWorkspacePlanRequestSchema = z.object({
  ...AnswerFields,
  directory: DirectorySchema,
})

export const WorkspaceBriefAnswersSchema = z.object({
  ...AnswerFields,
  advancedNotes: z.string().max(2_000).optional(),
})

export const WorkspacePlanSchema = z.object({
  oneLine: z.string(),
  build: z.array(z.object({ text: z.string(), source: z.string() })),
  remembers: z.array(z.string()),
  leftOut: z.array(z.string()),
  mvpNutshell: z.string(),
  goals: z.array(z.object({ title: z.string(), bullets: z.array(z.string()) })),
  sessions: z.array(
    z.object({ name: z.string(), items: z.array(z.string()), mvp: z.boolean() }),
  ),
})

// Null = no synthesis could be made; the wizard falls back to its own
// mechanical derivation so the screen is never empty.
export const SynthesizeWorkspacePlanResponseSchema = z.object({
  plan: WorkspacePlanSchema.nullable(),
})

// Finish: the chosen folder becomes the workspace — README, git, the row, the brief.
export const ScaffoldWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  directory: DirectorySchema,
  /** The menu-tree group the wizard was opened from; omitted = the tree root. */
  groupId: z.string().min(1).optional(),
  answers: WorkspaceBriefAnswersSchema,
  plan: WorkspacePlanSchema,
})

export const WorkspaceBriefResponseSchema = z.object({
  workspaceId: z.string(),
  answers: WorkspaceBriefAnswersSchema,
  plan: WorkspacePlanSchema,
  brief: z.string(),
  createdAt: z.string(),
})

export const ScaffoldWorkspaceResponseSchema = z.object({
  workspace: WorkspaceResponseSchema,
  git: z.union([
    z.object({ kind: z.literal('initialized') }),
    z.object({ kind: z.literal('existing') }),
    z.object({ kind: z.literal('skipped'), reason: z.string() }),
  ]),
  brief: WorkspaceBriefResponseSchema,
})

// Null = the workspace was not made by the wizard.
export const GetWorkspaceBriefResponseSchema = z.object({
  brief: WorkspaceBriefResponseSchema.nullable(),
})

// "Create from a repository": clone INTO the chosen (empty) folder.
export const CloneRepositoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  directory: DirectorySchema,
  /** An https / ssh git address — the op refuses anything else before git sees it. */
  repositoryUrl: z.string().trim().min(1).max(2_000),
  groupId: z.string().min(1).optional(),
})

export const CloneRepositoryResponseSchema = z.object({
  workspace: WorkspaceResponseSchema,
})
