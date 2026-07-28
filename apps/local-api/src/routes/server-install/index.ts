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
import { openSecret } from '@vynel/sealing'
import {
  ClaudeAuthRelay,
  findServerInstallById,
  hardDeleteServerInstall,
  listServerInstallsForUser,
  markServerInstallProvisioning,
  openServerConnection,
  readRemoteClaudeAuthStatus,
  runProvision,
  startServerInstall,
  type PayloadArchive,
  type ServerCredentials,
  type ServerInstall,
} from '@vynel/server-install'
import type { AppEnv } from '../../factory.js'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { serializeServerInstallForResponse } from './serializers.js'
import {
  ClaudeAuthStateResponseSchema,
  ListServerInstallsResponseSchema,
  RemoteClaudeAuthStatusResponseSchema,
  ServerInstallParamSchema,
  ServerInstallResponseSchema,
  StartServerInstallRequestSchema,
  SubmitClaudeAuthCodeRequestSchema,
} from './schemas.js'

// One relay per process — it holds a live PTY channel between the "show me the
// link" and "here is my code" round-trips (the AppProcessSupervisor precedent).
const claudeAuthRelay = new ClaudeAuthRelay()

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

// The relay and the status read both reach the server the same way the
// provisioner does — unsealing the install's own credential, pinned host key.
function openInstallConnection(c: Context<AppEnv>, install: ServerInstall) {
  const masterKey = requireMasterKey(c)
  const credentials = JSON.parse(
    openSecret(masterKey, install.encryptedCredentials),
  ) as ServerCredentials
  return openServerConnection({
    host: install.host,
    port: install.port,
    username: install.username,
    credentials,
    pinnedHostKeyFingerprint: install.hostKeyFingerprint,
  })
}

function requireInstalled(install: ServerInstall): ServerInstall {
  if (install.status !== 'installed') {
    throw new ConflictError(
      'This server is not ready yet — wait for the install to finish, then sign in to Claude.',
    )
  }
  return install
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
  // POST /:installId/reprovision — re-ship the engine this app ships (D5's
  // desktop-driven update). Reuses the sealed credentials + the pinned host
  // key; the install step swaps beside the running engine, so user data in
  // ~/.vynel/data survives.
  .post(
    '/:installId/reprovision',
    describeRoute({
      tags: ['server-install'],
      summary: "Update the server's engine to the version this app ships.",
      'x-sdk-name': 'serverInstall.reprovision',
      responses: {
        200: {
          description: 'The row, back in provisioning — poll it for step progress.',
          content: { 'application/json': { schema: resolver(ServerInstallResponseSchema) } },
        },
        404: { description: 'Unknown install, or not owned.' },
        409: { description: 'No engine payload available, or a run is already in flight.' },
      },
    }),
    validator('param', ServerInstallParamSchema),
    ...userScoped,
    (c) => {
      const masterKey = requireMasterKey(c)
      const payloadArchive = requirePayloadArchive(c)
      const install = getOwnedInstallOrThrow(c, c.req.valid('param').installId)
      if (install.status === 'provisioning') {
        throw new ConflictError('This server is already being set up — wait for it to finish.')
      }
      // A half-finished sign-in belongs to the OLD engine tree.
      claudeAuthRelay.discard(install.id)
      const reset = markServerInstallProvisioning(c.var.db, install.id)
      const logger = c.var.logger
      void runProvision(c.var.db, install.id, {
        masterKeyBase64: masterKey,
        appVersion: c.var.appVersion,
        payloadArchive,
        logger,
      }).catch((error: unknown) => {
        logger.warn(
          { installId: install.id, err: error },
          'server reprovision ended with an error (row settled separately)',
        )
      })
      return c.json(serializeServerInstallForResponse(reset))
    },
  )
  // GET /:installId/claude-auth — is the remote engine signed in to Claude?
  .get(
    '/:installId/claude-auth',
    describeRoute({
      tags: ['server-install'],
      summary: "Whether the remote engine is signed in to the user's Claude account.",
      'x-sdk-name': 'serverInstall.getClaudeAuthStatus',
      responses: {
        200: {
          description: "{ isSignedIn, detail } — the CLI's own verdict; never a credential.",
          content: { 'application/json': { schema: resolver(RemoteClaudeAuthStatusResponseSchema) } },
        },
        404: { description: 'Unknown install, or not owned.' },
        409: { description: 'The install is not ready yet.' },
      },
    }),
    validator('param', ServerInstallParamSchema),
    ...userScoped,
    async (c) => {
      const install = requireInstalled(getOwnedInstallOrThrow(c, c.req.valid('param').installId))
      const connection = await openInstallConnection(c, install)
      try {
        return c.json(await readRemoteClaudeAuthStatus(connection))
      } finally {
        connection.close()
      }
    },
  )
  // POST /:installId/claude-auth — begin sign-in; answers with the URL to open.
  .post(
    '/:installId/claude-auth',
    describeRoute({
      tags: ['server-install'],
      summary: 'Start signing the remote engine in to Claude (returns the link to open).',
      'x-sdk-name': 'serverInstall.startClaudeAuth',
      responses: {
        200: {
          description: '{ phase, authorizationUrl, errorMessage } — open the URL, then POST the code.',
          content: { 'application/json': { schema: resolver(ClaudeAuthStateResponseSchema) } },
        },
        404: { description: 'Unknown install, or not owned.' },
        409: { description: 'The install is not ready, or the server offered no sign-in link.' },
      },
    }),
    validator('param', ServerInstallParamSchema),
    ...userScoped,
    async (c) => {
      const install = requireInstalled(getOwnedInstallOrThrow(c, c.req.valid('param').installId))
      return c.json(
        await claudeAuthRelay.begin(install.id, {
          openConnection: () => openInstallConnection(c, install),
          logger: c.var.logger,
        }),
      )
    },
  )
  // POST /:installId/claude-auth/code — hand the CLI the pasted code.
  .post(
    '/:installId/claude-auth/code',
    describeRoute({
      tags: ['server-install'],
      summary: 'Give the server the code copied from the browser, finishing sign-in.',
      'x-sdk-name': 'serverInstall.submitClaudeAuthCode',
      responses: {
        200: {
          description: '{ phase, … } — poll GET /claude-auth for the final verdict.',
          content: { 'application/json': { schema: resolver(ClaudeAuthStateResponseSchema) } },
        },
        400: { description: 'The code was empty.' },
        404: { description: 'Unknown install, or no sign-in in progress.' },
      },
    }),
    validator('param', ServerInstallParamSchema),
    validator('json', SubmitClaudeAuthCodeRequestSchema),
    ...userScoped,
    (c) => {
      const install = getOwnedInstallOrThrow(c, c.req.valid('param').installId)
      return c.json(claudeAuthRelay.submitCode(install.id, c.req.valid('json').code))
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
      // Drop any half-finished sign-in with the row, or its PTY channel would
      // outlive the install it belongs to.
      claudeAuthRelay.discard(installId)
      hardDeleteServerInstall(c.var.db, installId)
      return c.body(null, 204)
    },
  )
