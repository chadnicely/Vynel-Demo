// The `/hub` HTTP surface — the desktop UI's window onto the daemon's hub
// session (`@vynel/hub-account`):
//
//   GET    /session            -> current HubLinkStatus
//   POST   /sign-in            -> email+password against the hub
//   POST   /sign-out           -> clear the device session (local + hub)
//   GET    /devices            -> the account's live devices
//   DELETE /devices/:deviceId  -> revoke one device
//
// MCP exposure: NONE — account management is a user action, never an agent
// tool. When `VYNEL_HUB_URL` is unset the session var is absent: GET
// /session answers `not-configured`, mutations 400 with the actionable env
// hint (dev without a hub keeps working).
//
// Error mapping: none here — hub/leaf errors are `VynelError` subclasses,
// mapped by the global `onError`.

import { resolver, validator } from 'hono-openapi/zod'
import { ValidationError } from '@vynel/errors'
import type { HubSession } from '@vynel/hub-account'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import {
  HubDevicesResponseSchema,
  HubLinkStatusSchema,
  HubRevokeDeviceResponseSchema,
  HubSignInBodySchema,
} from './schemas.js'

function requireHubSession(hubSession: HubSession | undefined): HubSession {
  if (hubSession === undefined) {
    throw new ValidationError(
      'The hub is not configured — set VYNEL_HUB_URL in the daemon env to enable accounts.',
    )
  }
  return hubSession
}

export const hubApp = factory
  .createApp()
  .get(
    '/session',
    describeRoute({
      tags: ['hub'],
      summary: "The desktop's hub-account link status.",
      'x-sdk-name': 'hub.getSession',
      responses: {
        200: {
          description: 'The HubLinkStatus union.',
          content: { 'application/json': { schema: resolver(HubLinkStatusSchema) } },
        },
      },
    }),
    (c) => {
      const status = c.var.hubSession?.getStatus() ?? { kind: 'not-configured' as const }
      return c.json(status)
    },
  )
  .post(
    '/sign-in',
    describeRoute({
      tags: ['hub'],
      summary: 'Sign in to the Vynel hub with email + password.',
      'x-sdk-name': 'hub.signIn',
      responses: {
        200: {
          description: 'The resulting HubLinkStatus (signed-in on success).',
          content: { 'application/json': { schema: resolver(HubLinkStatusSchema) } },
        },
        401: { description: 'Wrong email or password.' },
        403: { description: 'Account disabled.' },
      },
    }),
    validator('json', HubSignInBodySchema),
    async (c) => {
      const status = await requireHubSession(c.var.hubSession).signIn(c.req.valid('json'))
      return c.json(status)
    },
  )
  .post(
    '/sign-out',
    describeRoute({
      tags: ['hub'],
      summary: 'Sign this device out of the Vynel hub.',
      'x-sdk-name': 'hub.signOut',
      responses: {
        200: {
          description: 'The resulting HubLinkStatus (signed-out).',
          content: { 'application/json': { schema: resolver(HubLinkStatusSchema) } },
        },
      },
    }),
    async (c) => {
      const status = await requireHubSession(c.var.hubSession).signOut()
      return c.json(status)
    },
  )
  .get(
    '/devices',
    describeRoute({
      tags: ['hub'],
      summary: "The hub account's signed-in devices.",
      'x-sdk-name': 'hub.listDevices',
      responses: {
        200: {
          description: '{ devices: HubDeviceView[] }.',
          content: { 'application/json': { schema: resolver(HubDevicesResponseSchema) } },
        },
        401: { description: 'Not signed in.' },
      },
    }),
    async (c) => {
      const devices = await requireHubSession(c.var.hubSession).listDevices()
      return c.json({ devices })
    },
  )
  .delete(
    '/devices/:deviceId',
    describeRoute({
      tags: ['hub'],
      summary: 'Revoke one signed-in device (its session dies at next contact).',
      'x-sdk-name': 'hub.revokeDevice',
      responses: {
        200: {
          description: '{ revoked: true }.',
          content: { 'application/json': { schema: resolver(HubRevokeDeviceResponseSchema) } },
        },
        404: { description: 'Device not found.' },
      },
    }),
    async (c) => {
      await requireHubSession(c.var.hubSession).revokeDevice(c.req.param('deviceId'))
      return c.json({ revoked: true as const })
    },
  )
