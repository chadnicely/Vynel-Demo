// Zod schemas for the workspace wizard routes (api-internal — one consumer).

import { z } from 'zod'

/** The folder the user chose as the app's home (screen 1) — its parent,
 *  since the app does not exist yet. It grounds the one-shot dispatch (the
 *  cwd); nothing is written there, though its own Claude Code settings /
 *  CLAUDE.md load as for any workspace. */
const ParentPathSchema = z.string().min(1).max(4_096)

export const StudyRivalSiteRequestSchema = z.object({
  /** The site as the user typed it — "opentable.com" (the UI's own floor). */
  site: z.string().trim().min(4).max(200),
  /** The user's idea, so the study is about THEIR angle on the site. */
  idea: z.string().min(1).max(5_000),
  parentPath: ParentPathSchema,
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

export const SynthesizeWorkspacePlanRequestSchema = z.object({
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
  parentPath: ParentPathSchema,
})

const WorkspacePlanSchema = z.object({
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
