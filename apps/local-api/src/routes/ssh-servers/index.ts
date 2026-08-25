// The `ssh-servers` HTTP surface — USER-scoped only, mounted at `/ssh-servers`
// from `apps/local-api/src/app.ts` behind `featureGate('ssh')` (pro):
//
//   GET    /                          -> listSshServers
//   POST   /                          -> addSshServer     (the credential's ONLY door)
//   DELETE /:serverId                 -> removeSshServer
//   POST   /:serverId/test-connection -> runServerCommand (echo probe + TOFU pin)
//
// NO x-mcp anywhere — the agent's surface is the `vynel-ssh` descriptor
// (list_ssh_servers / run_ssh_command), never these routes. Registration and
// removal are always the user's door: the credential goes in ONCE through the
// add form, is sealed by the leaf, and no response anywhere carries it back
// out (serializers.ts is the stripping boundary). The identical-404 discipline
// (not-found = not-owned) lives in the leaf ops.
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` → handler
// on `factory.createApp()`; handlers THROW typed VynelError subclasses.

import { resolver, validator } from 'hono-openapi/zod'
import type { Context } from 'hono'
import { ConflictError, ValidationError, VynelError } from '@vynel/errors'
import { requireSealingMasterKey } from '../../sealing-master-key.js'
import {
  addSshServer,
  listSshServers,
  removeSshServer,
  runServerCommand,
  SshHostKeyMismatchError,
} from '@vynel/ssh-servers'
import type { AppEnv } from '../../factory.js'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { serializeSshServerForResponse } from './serializers.js'
import {
  SshServerParamSchema,
  AddSshServerRequestSchema,
  SshServerResponseSchema,
  ListSshServersResponseSchema,
  TestSshConnectionResponseSchema,
} from './schemas.js'

// The sealing master key is resolved from the OS keyring at boot (server.ts);
// a context without one (generators, tests that didn't pass it) cannot seal
// or open a credential, so the sealing routes refuse loudly — via the shared
// gate in `sealing-master-key.ts` (also the voice-providers stance).
function requireSshMasterKey(c: Context<AppEnv>): string {
  return requireSealingMasterKey(c, 'SSH')
}

export const sshServersApp = factory
  .createApp()
  // GET / — every server the user registered, both scopes (no credentials, ever).
  .get(
    '/',
    describeRoute({
      tags: ['ssh-servers'],
      summary: "List the user's registered SSH servers — global + workspace.",
      'x-sdk-name': 'sshServers.list',
      responses: {
        200: {
          description: 'Array of SshServer (never includes credentials).',
          content: { 'application/json': { schema: resolver(ListSshServersResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const servers = listSshServers(c.var.db, { userId: c.var.user.id })
      return c.json(servers.map(serializeSshServerForResponse))
    },
  )
  // POST / — register a server; the credential arrives ONCE and is sealed by the leaf.
  .post(
    '/',
    describeRoute({
      tags: ['ssh-servers'],
      summary: 'Register an SSH server (the credential is sealed and never returned).',
      'x-sdk-name': 'sshServers.add',
      responses: {
        201: {
          description: 'SshServer registered (no credentials in the response).',
          content: { 'application/json': { schema: resolver(SshServerResponseSchema) } },
        },
        400: { description: 'Validation error, or workspaceId missing for a workspace scope.' },
        409: { description: 'Duplicate server name, or the sealing key is unavailable.' },
      },
    }),
    validator('json', AddSshServerRequestSchema),
    ...userScoped,
    (c) => {
      const masterKeyBase64 = requireSshMasterKey(c)
      const body = c.req.valid('json')
      // Re-spread so an absent passphrase stays ABSENT (zod infers
      // `passphrase?: string | undefined`; the leaf's SshCredentials is
      // exact-optional — the tasks optional-field spread precedent).
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
      const server = addSshServer(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: body.scope === 'global' ? null : body.workspaceId,
          name: body.name,
          host: body.host,
          ...(body.port !== undefined ? { port: body.port } : {}),
          username: body.username,
          credentials,
        },
        { masterKeyBase64, logger: c.var.logger },
      )
      return c.json(serializeSshServerForResponse(server), 201)
    },
  )
  // DELETE /:serverId — remove a server (hard delete; the sealed blob dies with the row).
  .delete(
    '/:serverId',
    describeRoute({
      tags: ['ssh-servers'],
      summary: 'Remove an SSH server the user owns (hard delete).',
      'x-sdk-name': 'sshServers.remove',
      responses: {
        204: { description: 'Server removed.' },
        404: { description: 'No such server owned by this user.' },
      },
    }),
    validator('param', SshServerParamSchema),
    ...userScoped,
    (c) => {
      removeSshServer(
        c.var.db,
        { serverId: c.req.valid('param').serverId, userId: c.var.user.id },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )
  // POST /:serverId/test-connection — a harmless echo over the real connect
  // path: proves host + credential, and pins the host key on first success.
  .post(
    '/:serverId/test-connection',
    describeRoute({
      tags: ['ssh-servers'],
      summary: 'Test the connection to a registered server (pins the host key on first use).',
      'x-sdk-name': 'sshServers.testConnection',
      responses: {
        200: {
          description: 'Connected and authenticated; the observed host-key fingerprint.',
          content: { 'application/json': { schema: resolver(TestSshConnectionResponseSchema) } },
        },
        400: { description: 'Could not connect (unreachable, auth failed, or timed out).' },
        404: { description: 'No such server owned by this user.' },
        409: { description: "The server's host key changed, or the sealing key is unavailable." },
      },
    }),
    validator('param', SshServerParamSchema),
    ...userScoped,
    async (c) => {
      const masterKeyBase64 = requireSshMasterKey(c)
      try {
        const result = await runServerCommand(
          c.var.db,
          {
            serverId: c.req.valid('param').serverId,
            userId: c.var.user.id,
            command: 'echo vynel-connection-ok',
            description: 'Test the connection',
          },
          { masterKeyBase64, logger: c.var.logger },
        )
        return c.json({ ok: true as const, hostKeyFingerprint: result.hostKeyFingerprint })
      } catch (err) {
        // A changed host key is its own product moment ("this server's
        // identity changed") — surface it as a conflict, message intact.
        if (err instanceof SshHostKeyMismatchError) throw new ConflictError(err.message)
        // The op's own typed errors (the identical 404) pass through untouched.
        if (err instanceof VynelError) throw err
        // Everything else from the connect path (unreachable, auth failed,
        // timeout) becomes one friendly, actionable failure.
        throw new ValidationError(
          `Could not connect: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    },
  )
