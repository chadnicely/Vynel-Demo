// The workspace-scoped `phases` HTTP surface — mounted under
// `/workspaces/:workspaceId/phases` from `apps/local-api/src/app.ts`:
//
//   GET    /                   -> listPhases (previews)   [x-mcp]
//   POST   /                   -> createPhase             [x-mcp, mutatingApproved]
//   GET    /:phaseId           -> getPhaseOrThrow (full)  [x-mcp]
//   PATCH  /:phaseId           -> updatePhase             [x-mcp, mutatingApproved]
//   POST   /:phaseId/complete  -> updatePhase(status=done)[x-mcp, mutatingApproved]
//   DELETE /:phaseId           -> deletePhase             [x-mcp, mutatingApproved → ask tier]
//
// THIS IS THE AGENT'S SURFACE. Phases are the workspace's engineering build
// plan — big-form write-ups of how the app gets built, in build order. The
// LIST returns bounded description previews; the single GET carries the full
// text (contracts note). Writes are UNCARDED (mutatingApproved, the plans
// precedent: low-stakes, reversible); DELETE joins the generated ask-mode
// approval tier automatically (DELETE-method rule).
//
// Locked Hono protocol: describeRoute → validator → `...workspaceScoped` →
// handler on `factory.createApp()`; handlers THROW typed VynelError
// subclasses (the app.ts onError maps them).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { createPhase, deletePhase, getPhaseOrThrow, listPhases, updatePhase } from '@vynel/phases'
import { serializePhaseForResponse, serializePhaseForListResponse } from './serializers.js'
import {
  PhaseParamSchema,
  ListPhasesQuerySchema,
  CreatePhaseRequestSchema,
  UpdatePhaseRequestSchema,
  PhaseResponseSchema,
  ListPhasesResponseSchema,
} from './schemas.js'

export const phasesApp = factory
  .createApp()
  // GET / — the build plan in order (owner-scoped; bounded previews).
  .get(
    '/',
    describeRoute({
      tags: ['phases'],
      summary: "List the workspace's build-plan phases in order (previews only).",
      'x-sdk-name': 'phases.list',
      responses: {
        200: {
          description: 'Array of PhaseListItem (descriptionPreview, not the full text).',
          content: { 'application/json': { schema: resolver(ListPhasesResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_phases',
        description:
          "List the workspace's engineering build plan — its phases in build order. A phase is " +
          'one stage of how the app gets built: title, a big-form description (TRUNCATED to a ' +
          'preview here — call get_phase for the full write-up), 0-based `orderIndex`, and ' +
          'status (open / in-progress / done). Optional `status` filters to one status. Check ' +
          'this before planning or building anything, and keep statuses moving as stages land. ' +
          'Read-only.',
      },
    }),
    validator('query', ListPhasesQuerySchema),
    ...workspaceScoped,
    (c) => {
      const { status } = c.req.valid('query')
      const phases = listPhases(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        ...(status !== undefined ? { status } : {}),
      })
      return c.json(phases.map(serializePhaseForListResponse))
    },
  )
  // POST / — append a phase to the build plan.
  .post(
    '/',
    describeRoute({
      tags: ['phases'],
      summary: "Append a phase to the workspace's build plan.",
      'x-sdk-name': 'phases.create',
      responses: {
        201: {
          description: 'Phase created.',
          content: { 'application/json': { schema: resolver(PhaseResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'create_phase',
        description:
          'Add a phase to the workspace\'s engineering build plan — one stage of "how the app ' +
          'gets built" ("Phase 1 — Foundations", "Phase 2 — Ordering flow"). `title` is the ' +
          'short label (≤200 chars); `description` is the FULL write-up (up to 50k chars): ' +
          'scope, the pieces to build, decisions, and what "done" means for the stage. New ' +
          'phases append to the end of the build order. Link the features a phase delivers via ' +
          "create_feature / update_feature with this phase's id. Side effect: the phase joins " +
          "the workspace's build plan.",
        mutatingApproved: true,
      },
    }),
    validator('json', CreatePhaseRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      const phase = createPhase(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
          title: body.title,
          description: body.description,
          ...(body.sessionId !== undefined ? { sessionId: body.sessionId } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializePhaseForResponse(phase), 201)
    },
  )
  // GET /:phaseId — the full big-form write-up (owner-scoped).
  .get(
    '/:phaseId',
    describeRoute({
      tags: ['phases'],
      summary: "Read one phase with its full description.",
      'x-sdk-name': 'phases.get',
      responses: {
        200: {
          description: 'The phase, full description included.',
          content: { 'application/json': { schema: resolver(PhaseResponseSchema) } },
        },
        404: { description: 'No such phase owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_phase',
        description:
          "Read one build-plan phase with its FULL description — the complete write-up of the " +
          'stage (list_phases only carries previews). Use this before working on a phase so the ' +
          'full plan text grounds the work. Read-only.',
      },
    }),
    validator('param', PhaseParamSchema),
    ...workspaceScoped,
    (c) => {
      const phase = getPhaseOrThrow(c.var.db, {
        phaseId: c.req.valid('param').phaseId,
        userId: c.var.user.id,
      })
      return c.json(serializePhaseForResponse(phase))
    },
  )
  // PATCH /:phaseId — update title/description/status/orderIndex (owner-scoped).
  .patch(
    '/:phaseId',
    describeRoute({
      tags: ['phases'],
      summary: 'Update a phase (title, description, status, or position).',
      'x-sdk-name': 'phases.update',
      responses: {
        200: {
          description: 'Phase updated.',
          content: { 'application/json': { schema: resolver(PhaseResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'No such phase owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'update_phase',
        description:
          'Update a phase. Set status "in-progress" when its build work starts, back to "open" ' +
          'if it stalls, or "done" when the stage landed (complete_phase is the shortcut). ' +
          '`description` REPLACES the full write-up — send the complete new text, not a diff. ' +
          '`orderIndex` moves the phase within the build order when the plan is reshaped. ' +
          'Statuses: open / in-progress / done.',
        mutatingApproved: true,
      },
    }),
    validator('param', PhaseParamSchema),
    validator('json', UpdatePhaseRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      const phase = updatePhase(
        c.var.db,
        {
          phaseId: c.req.valid('param').phaseId,
          userId: c.var.user.id,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.orderIndex !== undefined ? { orderIndex: body.orderIndex } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializePhaseForResponse(phase))
    },
  )
  // POST /:phaseId/complete — mark done (stamps completedAt; emits phase.completed).
  .post(
    '/:phaseId/complete',
    describeRoute({
      tags: ['phases'],
      summary: 'Mark a phase done.',
      'x-sdk-name': 'phases.complete',
      responses: {
        200: {
          description: 'Phase completed.',
          content: { 'application/json': { schema: resolver(PhaseResponseSchema) } },
        },
        404: { description: 'No such phase owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'complete_phase',
        description:
          'Mark a build-plan phase done when its stage has landed and been verified — typically ' +
          'after the features it delivers are complete. The user sees completed phases as the ' +
          'record of how far the build has come.',
        mutatingApproved: true,
      },
    }),
    validator('param', PhaseParamSchema),
    ...workspaceScoped,
    (c) => {
      const phase = updatePhase(
        c.var.db,
        { phaseId: c.req.valid('param').phaseId, userId: c.var.user.id, status: 'done' },
        { logger: c.var.logger },
      )
      return c.json(serializePhaseForResponse(phase))
    },
  )
  // DELETE /:phaseId — remove from the plan (ask-mode approval tier via the
  // DELETE-method rule; features keep their loose phaseId dangling harmlessly).
  .delete(
    '/:phaseId',
    describeRoute({
      tags: ['phases'],
      summary: 'Remove a phase from the build plan.',
      'x-sdk-name': 'phases.remove',
      responses: {
        204: { description: 'Phase removed.' },
        404: { description: 'No such phase owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'delete_phase',
        description:
          'Remove a phase from the build plan — only when the user reshapes the plan and a ' +
          'stage genuinely goes away (prefer update_phase for renames and reordering). Features ' +
          'linked to it stay; unlink or relink them with update_feature. This permanently ' +
          "deletes the phase's write-up.",
        mutatingApproved: true,
      },
    }),
    validator('param', PhaseParamSchema),
    ...workspaceScoped,
    (c) => {
      deletePhase(
        c.var.db,
        { phaseId: c.req.valid('param').phaseId, userId: c.var.user.id },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )
