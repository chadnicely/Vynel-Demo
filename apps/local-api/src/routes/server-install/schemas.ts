// Zod request/response schemas for `server-install` routes. XxxSchema suffix;
// API-internal (single consumer) so they live beside the routes. Caps mirror
// the leaf op's own validation (host ≤ 253, username ≤ 64, port 1–65535).

import { z } from 'zod'

export const ServerInstallParamSchema = z.object({
  installId: z.string().min(1),
})

// The `POST /server-install` body — the ONLY door the server credential
// enters through (sealed immediately by the leaf op; never returned).
// Machine-level: no scope/workspaceId — a remote engine serves everything.
const ServerCredentialsSchema = z.discriminatedUnion('authKind', [
  z.object({ authKind: z.literal('password'), password: z.string().min(1) }),
  z.object({
    authKind: z.literal('private-key'),
    privateKey: z.string().min(1),
    passphrase: z.string().min(1).optional(),
  }),
])

export const StartServerInstallRequestSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(64),
  credentials: ServerCredentialsSchema,
})

// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `ServerInstallResponse` from
// `@vynel/contracts/server-install/server-install-http` (the ssh precedent):
// declared here so `describeRoute` can attach a real OpenAPI body via
// `resolver()`. NO sealed blobs — credentials and the bearer never leave.

export const ServerInstallResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  host: z.string(),
  port: z.number(),
  username: z.string(),
  authKind: z.enum(['password', 'private-key']),
  hostKeyFingerprint: z.string().nullable(),
  status: z.enum(['provisioning', 'installed', 'failed']),
  step: z.enum(['connect', 'preflight', 'upload', 'install', 'start', 'health']).nullable(),
  errorMessage: z.string().nullable(),
  installedVersion: z.string().nullable(),
  lastHealthyAt: z.string().nullable(), // ISO-8601 or null
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListServerInstallsResponseSchema = z.array(ServerInstallResponseSchema)

// ── Claude sign-in on the server (D4b) ──────────────────────────────
// Vynel relays the CLI's own flow: it hands back the authorization URL, takes
// the code the user pasted from their browser, and reports the CLI's verdict.
// No credential value ever crosses this surface (decision D14).

export const SubmitClaudeAuthCodeRequestSchema = z.object({
  code: z.string().min(1).max(400),
})

export const ClaudeAuthStateResponseSchema = z.object({
  phase: z.enum(['awaiting-authorization', 'finishing', 'signed-in', 'failed']),
  authorizationUrl: z.string().nullable(),
  errorMessage: z.string().nullable(),
})

export const RemoteClaudeAuthStatusResponseSchema = z.object({
  isSignedIn: z.boolean(),
  detail: z.string(),
})
