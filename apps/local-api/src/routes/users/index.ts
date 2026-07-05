// The `users` HTTP surface — 4 routes mounted at `/users` (NO workspace
// prefix — user-scoped, per `docs/blueprints/users/blueprint.md §7.2`) from
// `apps/local-api/src/app.ts`:
//
//   GET   /me              -> (resolved user)              [x-mcp]
//   PATCH /me              -> updateUserProfile
//   GET   /me/preferences  -> getUserPreferences            [x-mcp]
//   PATCH /me/preferences  -> setUserPreferences + getUserPreferences
//
// Locked Hono protocol per `coding-standard.md` "Hono routes" +
// `sdk-mcp.md`: describeRoute (the local openapi.js wrapper — widens the
// type for x-mcp + x-sdk-name) -> validator (from hono-openapi/zod) ->
// `...userScoped` -> handler. Chained methods on `factory.createApp()`.
//
// MCP exposure: the two safe-read GETs are x-mcp pre-annotated
// (get_current_user, get_user_preferences), mirroring the source route
// exactly. Neither PATCH carries x-mcp — mutating exposure waits for a
// per-route scope review per sdk-mcp.md "Safe-by-default".
//
// Error mapping: NONE here. Core ops throw typed `VynelError` subclasses;
// the global `onError` middleware in `app.ts` maps them to HTTP.

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { updateUserProfile, getUserPreferences, setUserPreferences } from '@vynel/core/users'
import {
  UpdateUserProfileRequestSchema,
  SetUserPreferencesRequestSchema,
  UserResponseSchema,
  UserPreferencesResponseSchema,
} from './schemas.js'
import { serializeUserForResponse } from './serializers.js'

export const usersApp = factory
  .createApp()
  .get(
    '/me',
    describeRoute({
      tags: ['users'],
      summary: 'Get the authenticated user.',
      'x-sdk-name': 'users.getMe',
      responses: {
        200: {
          description: 'The user record.',
          content: { 'application/json': { schema: resolver(UserResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_current_user',
        description:
          'Get the current Vynel user (the single local user in Phase 1). Returns id, display name, email, locale, timezone, and onboarding status.',
      },
    }),
    ...userScoped,
    (c) => c.json(serializeUserForResponse(c.var.user)),
  )
  .patch(
    '/me',
    describeRoute({
      tags: ['users'],
      summary: 'Update the authenticated user profile.',
      'x-sdk-name': 'users.updateMe',
      responses: {
        200: {
          description: 'The updated user record.',
          content: { 'application/json': { schema: resolver(UserResponseSchema) } },
        },
        400: { description: 'Validation failed.' },
        404: { description: 'User not found.' },
      },
    }),
    validator('json', UpdateUserProfileRequestSchema),
    ...userScoped,
    (c) => {
      const input = c.req.valid('json')
      const updated = updateUserProfile(c.var.db, c.var.user.id, input, {
        logger: c.var.logger,
      })
      return c.json(serializeUserForResponse(updated))
    },
  )
  .get(
    '/me/preferences',
    describeRoute({
      tags: ['users'],
      summary: 'Get the resolved user preferences (defaults filled).',
      'x-sdk-name': 'users.getPreferences',
      responses: {
        200: {
          description: 'The resolved preferences object.',
          content: { 'application/json': { schema: resolver(UserPreferencesResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_user_preferences',
        description:
          "Get the current user's resolved preferences (theme, default workspace, chat streaming, reduced motion). Defaults fill any keys the user has not explicitly set.",
      },
    }),
    ...userScoped,
    (c) => {
      const preferences = getUserPreferences(c.var.db, c.var.user.id)
      return c.json(preferences)
    },
  )
  .patch(
    '/me/preferences',
    describeRoute({
      tags: ['users'],
      summary: 'Update one or more user preferences.',
      'x-sdk-name': 'users.updatePreferences',
      responses: {
        200: {
          description: 'The resolved preferences after the update.',
          content: { 'application/json': { schema: resolver(UserPreferencesResponseSchema) } },
        },
        400: { description: 'Validation failed.' },
      },
    }),
    validator('json', SetUserPreferencesRequestSchema),
    ...userScoped,
    (c) => {
      const input = c.req.valid('json')
      setUserPreferences(c.var.db, c.var.user.id, input)
      const preferences = getUserPreferences(c.var.db, c.var.user.id)
      return c.json(preferences)
    },
  )
