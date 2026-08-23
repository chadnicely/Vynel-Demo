// The `github` HTTP surface — mounted at `/github` from `apps/local-api/src/app.ts`.
// The app's ONE GitHub connection (global — Kafi, 2026-08-23), entirely over
// the GitHub CLI; Vynel never sees the token.
//
//   GET    /connection                  -> gh auth status, in three honest answers
//   POST   /connection/sign-in          -> begin `gh auth login --web`: the one-time code + URL
//   GET    /connection/sign-in/:loginId -> where that sign-in stands (poll)
//   DELETE /connection/sign-in/:loginId -> abandon it (kills the CLI)
//   DELETE /connection                  -> gh auth logout
//
// No x-mcp: a session that needs to know runs `gh auth status` itself — the
// CLI is on its Bash. The connection reaches the CLI through
// `c.var.githubConnection` (the real CLI in production, a fake in tests —
// the `aiProvider` precedent).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  GitHubConnectionStatusResponseSchema,
  GitHubSignInStateResponseSchema,
  SignInIdParamSchema,
} from './schemas.js'

export const githubApp = factory
  .createApp()
  .get(
    '/connection',
    describeRoute({
      tags: ['github'],
      summary: 'The GitHub sign-in state on this computer (gh auth status).',
      'x-sdk-name': 'github.getConnection',
      responses: {
        200: {
          description: 'Installed? Signed in? As whom? — never an error for "no".',
          content: { 'application/json': { schema: resolver(GitHubConnectionStatusResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    async (c) => c.json(await c.var.githubConnection.readStatus()),
  )
  .post(
    '/connection/sign-in',
    describeRoute({
      tags: ['github'],
      summary: "Begin signing in: the CLI's one-time code + device URL, shown in the app.",
      'x-sdk-name': 'github.beginSignIn',
      responses: {
        200: {
          description:
            'The sign-in state — `awaiting-browser` with the code and URL, or `failed` with the reason.',
          content: { 'application/json': { schema: resolver(GitHubSignInStateResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    async (c) => c.json(await c.var.githubConnection.beginSignIn()),
  )
  .get(
    '/connection/sign-in/:loginId',
    describeRoute({
      tags: ['github'],
      summary: 'Where a sign-in stands — poll until signed-in or failed.',
      'x-sdk-name': 'github.getSignIn',
      responses: {
        200: {
          description: 'The sign-in state.',
          content: { 'application/json': { schema: resolver(GitHubSignInStateResponseSchema) } },
        },
        404: { description: 'No such sign-in (finished, abandoned, or never begun).' },
      },
    }),
    validator('param', SignInIdParamSchema),
    ...userScoped,
    (c) => c.json(c.var.githubConnection.getSignIn(c.req.valid('param').loginId)),
  )
  .delete(
    '/connection/sign-in/:loginId',
    describeRoute({
      tags: ['github'],
      summary: 'Abandon a sign-in — the CLI process is stopped.',
      'x-sdk-name': 'github.cancelSignIn',
      responses: { 204: { description: 'Abandoned (or already gone).' } },
    }),
    validator('param', SignInIdParamSchema),
    ...userScoped,
    (c) => {
      c.var.githubConnection.cancelSignIn(c.req.valid('param').loginId)
      return c.body(null, 204)
    },
  )
  .delete(
    '/connection',
    describeRoute({
      tags: ['github'],
      summary: 'Sign the CLI out of github.com.',
      'x-sdk-name': 'github.signOut',
      responses: { 204: { description: 'Signed out.' } },
    }),
    ...userScoped,
    async (c) => {
      await c.var.githubConnection.signOut()
      return c.body(null, 204)
    },
  )
