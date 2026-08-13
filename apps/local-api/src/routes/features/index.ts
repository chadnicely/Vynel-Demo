// The workspace-scoped `features` HTTP surface — mounted under
// `/workspaces/:workspaceId/features` from `apps/local-api/src/app.ts`:
//
//   GET    /                     -> listFeatures (previews)    [x-mcp]
//   POST   /                     -> createFeature              [x-mcp, mutatingApproved]
//   GET    /:featureId           -> getFeatureOrThrow (full)   [x-mcp]
//   PATCH  /:featureId           -> updateFeature              [x-mcp, mutatingApproved]
//   POST   /:featureId/complete  -> updateFeature(status=done) [x-mcp, mutatingApproved]
//   DELETE /:featureId           -> deleteFeature              [x-mcp, mutatingApproved → ask tier]
//
// THIS IS THE AGENT'S SURFACE. Features are the catalog of what the
// workspace's app should have — big-form write-ups, each optionally linked
// (loose `phaseId`) to the build-plan phase that delivers it. The LIST
// returns bounded description previews; the single GET carries the full text
// (contracts note). Writes are UNCARDED (mutatingApproved, the plans
// precedent); DELETE joins the generated ask-mode approval tier
// automatically (DELETE-method rule).
//
// Locked Hono protocol: describeRoute → validator → `...workspaceScoped` →
// handler on `factory.createApp()`; handlers THROW typed VynelError
// subclasses (the app.ts onError maps them).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  createFeature,
  deleteFeature,
  getFeatureOrThrow,
  listFeatures,
  updateFeature,
} from '@vynel/features'
import { serializeFeatureForResponse, serializeFeatureForListResponse } from './serializers.js'
import {
  FeatureParamSchema,
  ListFeaturesQuerySchema,
  CreateFeatureRequestSchema,
  UpdateFeatureRequestSchema,
  FeatureResponseSchema,
  ListFeaturesResponseSchema,
} from './schemas.js'

export const featuresApp = factory
  .createApp()
  // GET / — the feature catalog (owner-scoped; bounded previews).
  .get(
    '/',
    describeRoute({
      tags: ['features'],
      summary: "List the workspace's features (previews only).",
      'x-sdk-name': 'features.list',
      responses: {
        200: {
          description: 'Array of FeatureListItem (descriptionPreview, not the full text).',
          content: { 'application/json': { schema: resolver(ListFeaturesResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_features',
        description:
          "List the workspace's features — the catalog of what the app should have. Each " +
          'feature carries a title, a big-form description (TRUNCATED to a preview here — call ' +
          'get_feature for the full write-up), status (open / in-progress / done), and an ' +
          'optional `phaseId` linking it to the build-plan phase that delivers it. Optional ' +
          '`status` filters to one status; optional `phaseId` narrows to one phase\'s features. ' +
          'Check this before designing or building functionality. Read-only.',
      },
    }),
    validator('query', ListFeaturesQuerySchema),
    ...workspaceScoped,
    (c) => {
      const { status, phaseId } = c.req.valid('query')
      const features = listFeatures(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        ...(status !== undefined ? { status } : {}),
        ...(phaseId !== undefined ? { phaseId } : {}),
      })
      return c.json(features.map(serializeFeatureForListResponse))
    },
  )
  // POST / — add a feature to the catalog.
  .post(
    '/',
    describeRoute({
      tags: ['features'],
      summary: "Add a feature to the workspace's catalog.",
      'x-sdk-name': 'features.create',
      responses: {
        201: {
          description: 'Feature created.',
          content: { 'application/json': { schema: resolver(FeatureResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'create_feature',
        description:
          "Add a feature to the workspace's catalog — one thing the app should have (\"Online " +
          'ordering", "Loyalty points"). `title` is the short label (≤200 chars); `description` ' +
          'is the FULL write-up (up to 50k chars): what it does, how it behaves, edge cases, ' +
          'and what "done" means. Pass `phaseId` to link it to the build-plan phase that ' +
          "delivers it (list_phases shows the plan) — or leave it off and place it later with " +
          "update_feature. Side effect: the feature appears in the workspace's catalog.",
        mutatingApproved: true,
      },
    }),
    validator('json', CreateFeatureRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      const feature = createFeature(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
          title: body.title,
          description: body.description,
          ...(body.phaseId !== undefined ? { phaseId: body.phaseId } : {}),
          ...(body.sessionId !== undefined ? { sessionId: body.sessionId } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeFeatureForResponse(feature), 201)
    },
  )
  // GET /:featureId — the full big-form write-up (owner-scoped).
  .get(
    '/:featureId',
    describeRoute({
      tags: ['features'],
      summary: 'Read one feature with its full description.',
      'x-sdk-name': 'features.get',
      responses: {
        200: {
          description: 'The feature, full description included.',
          content: { 'application/json': { schema: resolver(FeatureResponseSchema) } },
        },
        404: { description: 'No such feature owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_feature',
        description:
          'Read one feature with its FULL description — the complete write-up of what it does ' +
          'and how it behaves (list_features only carries previews). Use this before building ' +
          'or changing the feature so the full spec grounds the work. Read-only.',
      },
    }),
    validator('param', FeatureParamSchema),
    ...workspaceScoped,
    (c) => {
      const feature = getFeatureOrThrow(c.var.db, {
        featureId: c.req.valid('param').featureId,
        userId: c.var.user.id,
      })
      return c.json(serializeFeatureForResponse(feature))
    },
  )
  // PATCH /:featureId — update title/description/status/phase link (owner-scoped).
  .patch(
    '/:featureId',
    describeRoute({
      tags: ['features'],
      summary: 'Update a feature (title, description, status, or phase link).',
      'x-sdk-name': 'features.update',
      responses: {
        200: {
          description: 'Feature updated.',
          content: { 'application/json': { schema: resolver(FeatureResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'No such feature owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'update_feature',
        description:
          'Update a feature. Set status "in-progress" when work on it starts, back to "open" ' +
          'if it stalls, or "done" when it shipped (complete_feature is the shortcut). ' +
          '`description` REPLACES the full write-up — send the complete new text, not a diff. ' +
          '`phaseId` links the feature to the build-plan phase that delivers it; pass null to ' +
          'unlink. Statuses: open / in-progress / done.',
        mutatingApproved: true,
      },
    }),
    validator('param', FeatureParamSchema),
    validator('json', UpdateFeatureRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      const feature = updateFeature(
        c.var.db,
        {
          featureId: c.req.valid('param').featureId,
          userId: c.var.user.id,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.phaseId !== undefined ? { phaseId: body.phaseId } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeFeatureForResponse(feature))
    },
  )
  // POST /:featureId/complete — mark done (stamps completedAt; emits feature.completed).
  .post(
    '/:featureId/complete',
    describeRoute({
      tags: ['features'],
      summary: 'Mark a feature done.',
      'x-sdk-name': 'features.complete',
      responses: {
        200: {
          description: 'Feature completed.',
          content: { 'application/json': { schema: resolver(FeatureResponseSchema) } },
        },
        404: { description: 'No such feature owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'complete_feature',
        description:
          'Mark a feature done when it has shipped and been verified. The user sees completed ' +
          'features as the record of what the app can already do.',
        mutatingApproved: true,
      },
    }),
    validator('param', FeatureParamSchema),
    ...workspaceScoped,
    (c) => {
      const feature = updateFeature(
        c.var.db,
        { featureId: c.req.valid('param').featureId, userId: c.var.user.id, status: 'done' },
        { logger: c.var.logger },
      )
      return c.json(serializeFeatureForResponse(feature))
    },
  )
  // DELETE /:featureId — remove from the catalog (ask-mode approval tier via
  // the DELETE-method rule).
  .delete(
    '/:featureId',
    describeRoute({
      tags: ['features'],
      summary: 'Remove a feature from the catalog.',
      'x-sdk-name': 'features.remove',
      responses: {
        204: { description: 'Feature removed.' },
        404: { description: 'No such feature owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'delete_feature',
        description:
          'Remove a feature from the catalog — only when the user decides the app should NOT ' +
          'have it (prefer update_feature for rewrites and re-linking). This permanently ' +
          "deletes the feature's write-up.",
        mutatingApproved: true,
      },
    }),
    validator('param', FeatureParamSchema),
    ...workspaceScoped,
    (c) => {
      deleteFeature(
        c.var.db,
        { featureId: c.req.valid('param').featureId, userId: c.var.user.id },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )
