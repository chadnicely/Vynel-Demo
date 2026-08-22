// The workspace wizard's HTTP surface — mounted at `/workspaces/wizard` from
// `apps/local-api/src/app.ts`. The wizard's two one-shot AI reads:
//
//   POST /study-rival -> what a named site does / leave out / magic   (no x-mcp)
//   POST /plan        -> every wizard answer distilled into the plan  (no x-mcp)
//   POST /scaffold    -> Finish: folder, README, git, the row, the brief (no x-mcp)
//
// Both go through the provider seam's best-effort one-shots (toolless, the
// capable model — plan quality is the product) via `c.var.aiProvider` (a
// fake in tests, the providers-route precedent). Null — the provider can't,
// or the dispatch failed — answers as `{ study: null }` / `{ plan: null }`:
// the wizard reports the study honestly or falls back to its own mechanical
// plan derivation, and nothing is lost. No x-mcp — these are human
// affordances inside the wizard, not agent tools.
//
// The dispatch cwd is the folder the user chose as the app's home on screen
// 1 (Kafi, 2026-08-23: the user's own folder, never the global space). It
// must exist — `resolveExistingDirectory` → 400 when it doesn't. Nothing is
// written there (the dispatch is toolless); the folder's own Claude Code
// settings / CLAUDE.md still load, exactly as they would for any workspace.

import { resolver, validator } from 'hono-openapi/zod'
import { resolveExistingDirectory, scaffoldWorkspace } from '@vynel/workspaces'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { serializeWorkspaceBrief } from './brief.js'
import { serializeWorkspaceForResponse } from './serialize-workspace.js'
import {
  ScaffoldWorkspaceRequestSchema,
  ScaffoldWorkspaceResponseSchema,
  StudyRivalSiteRequestSchema,
  StudyRivalSiteResponseSchema,
  SynthesizeWorkspacePlanRequestSchema,
  SynthesizeWorkspacePlanResponseSchema,
} from './wizard-schemas.js'

export const workspaceWizardApp = factory
  .createApp()
  .post(
    '/study-rival',
    describeRoute({
      tags: ['workspaces'],
      summary:
        "List what a named site does, from the provider's own knowledge (no live read).",
      'x-sdk-name': 'workspaces.studyRival',
      responses: {
        200: {
          description:
            '{ study } — null when the provider could not study the site; say so plainly.',
          content: { 'application/json': { schema: resolver(StudyRivalSiteResponseSchema) } },
        },
        400: { description: 'Validation error, or the chosen folder does not exist.' },
      },
    }),
    validator('json', StudyRivalSiteRequestSchema),
    ...userScoped,
    async (c) => {
      const { site, idea, parentPath } = c.req.valid('json')
      const workspacePath = await resolveExistingDirectory(parentPath)
      const study = await c.var.aiProvider.studyRivalSite({
        site,
        idea,
        workspacePath,
        logger: c.var.logger,
      })
      return c.json({ study })
    },
  )
  .post(
    '/plan',
    describeRoute({
      tags: ['workspaces'],
      summary: "Distill the wizard's answers into the plan the user rates.",
      'x-sdk-name': 'workspaces.synthesizePlan',
      responses: {
        200: {
          description:
            '{ plan } — null when no synthesis could be made; the wizard falls back to its own derivation.',
          content: {
            'application/json': { schema: resolver(SynthesizeWorkspacePlanResponseSchema) },
          },
        },
        400: { description: 'Validation error, or the chosen folder does not exist.' },
      },
    }),
    validator('json', SynthesizeWorkspacePlanRequestSchema),
    ...userScoped,
    async (c) => {
      const { parentPath, ...answers } = c.req.valid('json')
      const workspacePath = await resolveExistingDirectory(parentPath)
      const plan = await c.var.aiProvider.synthesizeWorkspacePlan({
        ...answers,
        workspacePath,
        logger: c.var.logger,
      })
      return c.json({ plan })
    },
  )
  // Finish. Does NOT start a build: the first session is the user pressing
  // send on the brief seeded into the new workspace's chat. No x-mcp — the
  // wizard's door, not an agent tool (register_workspace covers the agent).
  .post(
    '/scaffold',
    describeRoute({
      tags: ['workspaces'],
      summary: "Make the wizard's workspace: folder, README, git, the row, the stored brief.",
      'x-sdk-name': 'workspaces.scaffold',
      responses: {
        201: {
          description:
            'The workspace row, what actually happened with git (initialized / skipped), and the stored brief.',
          content: { 'application/json': { schema: resolver(ScaffoldWorkspaceResponseSchema) } },
        },
        400: { description: 'Validation error, or the chosen folder does not exist.' },
        404: { description: 'No such group owned by this user.' },
        409: { description: 'A folder with that name is already in the chosen folder.' },
      },
    }),
    validator('json', ScaffoldWorkspaceRequestSchema),
    ...userScoped,
    async (c) => {
      const { name, parentPath, folderName, groupId, answers, plan } = c.req.valid('json')
      // Zod types an omitted optional as `undefined`; the contract (and the
      // stored JSON) want the key absent.
      const { advancedNotes, ...answerFields } = answers
      const made = await scaffoldWorkspace(
        c.var.db,
        {
          userId: c.var.user.id,
          name,
          parentPath,
          ...(folderName === undefined ? {} : { folderName }),
          ...(groupId === undefined ? {} : { groupId }),
          answers: {
            ...answerFields,
            ...(advancedNotes === undefined ? {} : { advancedNotes }),
          },
          plan,
        },
        { logger: c.var.logger },
      )
      return c.json(
        {
          workspace: serializeWorkspaceForResponse(made.workspace),
          git: made.git,
          brief: serializeWorkspaceBrief(made.brief),
        },
        201,
      )
    },
  )
