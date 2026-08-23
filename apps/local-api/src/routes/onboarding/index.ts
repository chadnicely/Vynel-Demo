// The `onboarding` HTTP surface — 5 routes mounted at `/onboarding` from
// `apps/local-api/src/app.ts`:
//
//   POST /start                    -> startOnboardingRun
//   POST /restart                  -> restartOnboardingRun
//   GET  /status/needs-onboarding   -> checkIfOnboardingNeeded
//   GET  /:runId                   -> getOnboardingRunStatus
//   POST /:runId/submit            -> submitOnboardingStep
//
// Locked Hono protocol (coding-standard.md "Hono routes" + sdk-mcp.md):
// chained methods on `factory.createApp()`; `describeRoute` from the local
// `openapi.js` wrapper -> `validator` from `hono-openapi/zod` -> `...userScoped`
// -> handler. Handlers THROW typed VynelError subclasses; the app.ts middleware
// maps them. NO x-mcp: onboarding precedes the agent/MCP runtime (mirrors source
// exactly — the source route file carries the same note).
//
// These routes compose `...userScoped` (the user-resolver — `c.var.user` is the
// single boot-created user, D14) but NOT the workspace resolver (onboarding
// touches no workspace) — D7. The submit route binds the core-users ops via
// `buildOnboardingDeps` (the api-edge composition point — invariant #2: the
// onboarding leaf declares them only structurally).

import { resolver, validator } from 'hono-openapi/zod'
import {
  startOnboardingRun,
  restartOnboardingRun,
  getOnboardingRunStatus,
  checkIfOnboardingNeeded,
  submitOnboardingStep,
} from '@vynel/onboarding'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { buildOnboardingDeps } from './build-onboarding-deps.js'
import {
  RunIdParamSchema,
  SubmitStepBodySchema,
  OnboardingRunResponseSchema,
  NeedsOnboardingResponseSchema,
  OnboardingRunStatusSnapshotResponseSchema,
} from './schemas.js'

export const onboardingApp = factory
  .createApp()
  .post(
    '/start',
    describeRoute({
      tags: ['onboarding'],
      summary: 'Start or resume the onboarding run for the current user.',
      'x-sdk-name': 'onboarding.start',
      responses: {
        200: {
          description: 'The in-progress OnboardingRun.',
          content: { 'application/json': { schema: resolver(OnboardingRunResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => c.json(startOnboardingRun(c.var.db, c.var.user.id)),
  )
  .post(
    '/restart',
    describeRoute({
      tags: ['onboarding'],
      summary: 'Abandon any in-progress run and start a fresh one.',
      'x-sdk-name': 'onboarding.restart',
      responses: {
        200: {
          description: 'A fresh OnboardingRun.',
          content: { 'application/json': { schema: resolver(OnboardingRunResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => c.json(restartOnboardingRun(c.var.db, c.var.user.id)),
  )
  .get(
    '/status/needs-onboarding',
    describeRoute({
      tags: ['onboarding'],
      summary: 'Whether the current user still needs onboarding.',
      'x-sdk-name': 'onboarding.getNeedsOnboarding',
      responses: {
        200: {
          description: '{ needsOnboarding, inProgressRunId }.',
          content: { 'application/json': { schema: resolver(NeedsOnboardingResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => c.json(checkIfOnboardingNeeded(c.var.db, c.var.user.id)),
  )
  .get(
    '/:runId',
    describeRoute({
      tags: ['onboarding'],
      summary: 'Get the onboarding run status snapshot (owner-scoped).',
      'x-sdk-name': 'onboarding.getRunStatus',
      responses: {
        200: {
          description: 'The OnboardingRunStatusSnapshot.',
          content: { 'application/json': { schema: resolver(OnboardingRunStatusSnapshotResponseSchema) } },
        },
        404: { description: 'Run not found or not owned.' },
      },
    }),
    ...userScoped,
    validator('param', RunIdParamSchema),
    (c) => c.json(getOnboardingRunStatus(c.var.db, c.var.user.id, c.req.valid('param').runId)),
  )
  .post(
    '/:runId/submit',
    describeRoute({
      tags: ['onboarding'],
      summary: 'Submit one wizard step and advance the run.',
      'x-sdk-name': 'onboarding.submitStep',
      responses: {
        200: {
          description: 'The advanced OnboardingRun.',
          content: { 'application/json': { schema: resolver(OnboardingRunResponseSchema) } },
        },
        400: { description: 'Validation error or step-kind mismatch.' },
        404: { description: 'Run not found or not owned.' },
        409: { description: 'Run already completed.' },
      },
    }),
    ...userScoped,
    validator('param', RunIdParamSchema),
    validator('json', SubmitStepBodySchema),
    async (c) => {
      const { runId } = c.req.valid('param')
      const body = c.req.valid('json')
      const updated = await submitOnboardingStep(
        c.var.db,
        { userId: c.var.user.id, runId, stepKind: body.stepKind, stepInput: body.stepInput },
        buildOnboardingDeps(c.var.logger),
      )
      return c.json(updated)
    },
  )
