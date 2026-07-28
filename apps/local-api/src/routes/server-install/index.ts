// The `server-install` HTTP surface — USER-scoped, mounted at `/server-install`
// from `apps/local-api/src/app.ts`:
//
//   GET    /            -> listServerInstallsForUser
//   POST   /            -> startServerInstall + kick runProvision (background)
//   GET    /:installId  -> one install (the UI polls this for step progress)
//   DELETE /:installId  -> forget the install locally (v1: no remote uninstall)
//
// NO x-mcp anywhere — provisioning a server is the USER's door (onboarding +
// settings), never an agent tool. The credential goes in ONCE through the
// start form, is sealed by the leaf, and no response carries it (or the
// minted bearer) back out — serializers.ts is the stripping boundary.
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` → handler
// on `factory.createApp()`; handlers THROW typed VynelError subclasses.

import { resolver, validator } from 'hono-openapi/zod'
import type { Context } from 'hono'
import { ConflictError, NotFoundError } from '@vynel/errors'
import {
  findServerInstallById,
  hardDeleteServerInstall,
  listServerInstallsForUser,
  runProvision,
  startServerInstall,
  type PayloadArchive,
} from '@vynel/server-install'
import type { AppEnv } from '../../factory.js'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { serializeServerInstallForResponse } from './serializers.js'
import {
  ListServerInstallsResponseSchema,
  ServerInstallParamSchema,
  ServerInstallResponseSchema,
  StartServerInstallRequestSchema,
} from './schemas.js'

// Same closed-taxonomy rationale as the ssh routes' requireSshMasterKey:
// 409 is the closest fit for "this daemon can't take the request right now".
function requireMasterKey(c: Context<AppEnv>): string {
  const masterKey = c.var.sshMasterKey
  if (masterKey === null) {
    throw new ConflictError(
      'Server install is unavailable: the encryption key is not loaded. Restart Vynel and try again.',
    )
  }
  return masterKey
}

function requirePayloadArchive(c: Context<AppEnv>): PayloadArchive {
  const archive = c.var.serverPayloadArchive
  if (archive === null) {
    throw new ConflictError(
      'No server engine payload is available on this machine — update Vynel, or build one with `pnpm release:payload linux-x64` + `pnpm release:pack linux-x64` in dev.',
    )
  }
  return archive
}

function getOwnedInstallOrThrow(c: Context<AppEnv>, installId: string) {
  const install = findServerInstallById(c.var.db, installId)
  // Identical-404 discipline: not-found and not-owned are the same answer.
  if (install === null || install.userId !== c.var.user.id) {
    throw new NotFoundError('server-install', installId)
  }
  return install
}

export const serverInstallApp = factory
  .createApp()
  // GET / — every install the user provisioned (no sealed blobs, ever).
  .get(
    '/',
    describeRoute({
      tags: ['server-install'],
      summary: "List the user's remote engine installs.",
      'x-sdk-name': 'serverInstall.list',
      responses: {
        200: {
          description: 'Array of ServerInstall (never includes credentials or the bearer).',
          content: { 'application/json': { schema: resolver(ListServerInstallsResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const installs = listServerInstallsForUser(c.var.db, c.var.user.id)
      return c.json(installs.map(serializeServerInstallForResponse))
    },
  )
  // POST / — start provisioning; returns immediately with the provisioning row.
  .post(
    '/',
    describeRoute({
      tags: ['server-install'],
      summary: 'Provision a remote engine on a server over SSH (runs in the background).',
      'x-sdk-name': 'serverInstall.start',
      responses: {
        200: {
          description:
            'The provisioning row — poll GET /server-install/:installId to follow step progress.',
          content: { 'application/json': { schema: resolver(ServerInstallResponseSchema) } },
        },
        409: { description: 'No engine payload available, or the encryption key is not loaded.' },
      },
    }),
    validator('json', StartServerInstallRequestSchema),
    ...userScoped,
    (c) => {
      const masterKey = requireMasterKey(c)
      const payloadArchive = requirePayloadArchive(c)
      const body = c.req.valid('json')
      // Re-spread so an absent passphrase stays ABSENT (zod infers
      // `passphrase?: string | undefined`; the leaf's ServerCredentials is
      // exact-optional — the ssh-servers route precedent).
      const credentials =
        body.credentials.authKind === 'password'
          ? body.credentials
          : {
              authKind: body.credentials.authKind,
              privateKey: body.credentials.privateKey,
              ...(body.credentials.passphrase !== undefined
                ? { passphrase: body.credentials.passphrase }
                : {}),
            }
      const install = startServerInstall(
        c.var.db,
        {
          userId: c.var.user.id,
          host: body.host,
          ...(body.port !== undefined ? { port: body.port } : {}),
          username: body.username,
          credentials,
        },
        { masterKeyBase64: masterKey, logger: c.var.logger },
      )
      // Fire-and-track: the pipeline runs for minutes (a ~200 MB upload); the
      // row IS the progress surface. runProvision records its own failure
      // before rethrowing — this catch handles the rethrow (an unhandled
      // rejection would crash the daemon) and logs it in case the failure
      // never reached the row (e.g. the settle write itself failed).
      const logger = c.var.logger
      void runProvision(c.var.db, install.id, {
        masterKeyBase64: masterKey,
        appVersion: c.var.appVersion,
        payloadArchive,
        logger,
      }).catch((error: unknown) => {
        logger.warn(
          { installId: install.id, err: error },
          'server provision ended with an error (row settled separately)',
        )
      })
      return c.json(serializeServerInstallForResponse(install))
    },
  )
  // GET /:installId — the step-progress poll target.
  .get(
    '/:installId',
    describeRoute({
      tags: ['server-install'],
      summary: 'Get one remote engine install (status + step + error).',
      'x-sdk-name': 'serverInstall.get',
      responses: {
        200: {
          description: 'The install row.',
          content: { 'application/json': { schema: resolver(ServerInstallResponseSchema) } },
        },
        404: { description: 'Unknown install, or not owned.' },
      },
    }),
    validator('param', ServerInstallParamSchema),
    ...userScoped,
    (c) => {
      const { installId } = c.req.valid('param')
      return c.json(serializeServerInstallForResponse(getOwnedInstallOrThrow(c, installId)))
    },
  )
  // DELETE /:installId — forget locally. v1 leaves the server untouched (a
  // remote uninstall op is a deliberate later step, not a cascade surprise).
  .delete(
    '/:installId',
    describeRoute({
      tags: ['server-install'],
      summary: 'Forget a remote engine install (does not uninstall from the server).',
      'x-sdk-name': 'serverInstall.remove',
      responses: {
        204: { description: 'Forgotten.' },
        404: { description: 'Unknown install, or not owned.' },
      },
    }),
    validator('param', ServerInstallParamSchema),
    ...userScoped,
    (c) => {
      const { installId } = c.req.valid('param')
      getOwnedInstallOrThrow(c, installId)
      hardDeleteServerInstall(c.var.db, installId)
      return c.body(null, 204)
    },
  )
