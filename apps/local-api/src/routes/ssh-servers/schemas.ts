// Zod request/response schemas for `ssh-servers` routes. XxxSchema suffix;
// API-internal (single consumer) so they live beside the routes. Validated
// via `validator` from `hono-openapi/zod`. Caps mirror the leaf op's own
// validation (name ≤ 60, host ≤ 253, username ≤ 64, port 1–65535).

import { z } from 'zod'

export const SshServerParamSchema = z.object({
  serverId: z.string().min(1),
})

// The `POST /ssh-servers` body — the ONLY door a credential enters through
// (sealed immediately by the leaf op; never returned by anything). `scope`
// discriminates a GLOBAL server from a WORKSPACE one (the tasksUser.create
// precedent); `credentials` discriminates on authKind, matching the leaf's
// `SshCredentials` shape exactly.
const SshCredentialsSchema = z.discriminatedUnion('authKind', [
  z.object({ authKind: z.literal('password'), password: z.string().min(1) }),
  z.object({
    authKind: z.literal('private-key'),
    privateKey: z.string().min(1),
    passphrase: z.string().min(1).optional(),
  }),
])

const addSshServerFields = {
  name: z.string().min(1).max(60),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(64),
  credentials: SshCredentialsSchema,
}

export const AddSshServerRequestSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global'), ...addSshServerFields }),
  z.object({
    scope: z.literal('workspace'),
    workspaceId: z.string().min(1),
    ...addSshServerFields,
  }),
])

// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `SshServerResponse` from `@vynel/contracts/ssh/ssh-http`
// (the type `serializeSshServerForResponse` is cast to). Declared here — not
// inverted to `z.infer` — because the canonical type lives in contracts; the
// schema exists so `describeRoute` can attach a real OpenAPI response body
// via `resolver()` (the tasks precedent). NO encryptedCredentials — the
// sealed blob never leaves the leaf.

const SshAuthKindResponseSchema = z.enum(['password', 'private-key'])

export const SshServerResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  // Null = GLOBAL scope — a user-level server with no workspace.
  workspaceId: z.string().nullable(),
  name: z.string(),
  host: z.string(),
  port: z.number(),
  username: z.string(),
  authKind: SshAuthKindResponseSchema,
  hostKeyFingerprint: z.string().nullable(),
  lastConnectedAt: z.string().nullable(), // ISO-8601 or null
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListSshServersResponseSchema = z.array(SshServerResponseSchema)

export const TestSshConnectionResponseSchema = z.object({
  ok: z.literal(true),
  // The fingerprint the server presented (pinned on first success — TOFU).
  hostKeyFingerprint: z.string(),
})
